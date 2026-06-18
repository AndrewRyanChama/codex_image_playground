import asyncio
import base64
import json
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI, DefaultAioHttpClient
from openai.types.images_response import ImagesResponse
from pydantic import BaseModel, Field
from uuid import uuid4

IMAGES_DIR = Path("images")
ROOT_HTML = Path("index.html")
IMAGES_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Image Playground")
app.mount("/images", StaticFiles(directory=IMAGES_DIR), name="images")


class ImageInfo(BaseModel):
    filename: str
    url: str


class ListImagesResponse(BaseModel):
    images: list[ImageInfo]


class GenerateImageRequest(BaseModel):
    prompt: str
    image_filenames: list[str] = Field(default_factory=list)
    size: str = "3840x2160"


class GenerateImageResponse(BaseModel):
    image: ImageInfo


auth_json = json.loads(Path("~/.codex/auth.json").expanduser().read_text())
client = AsyncOpenAI(
        api_key=auth_json["tokens"]["access_token"],
        http_client=DefaultAioHttpClient(),
        base_url="https://chatgpt.com/backend-api/codex",
    )


def image_url(filename: str) -> str:
    return f"/images/{quote(filename)}"


def validate_image_filename(filename: str) -> None:
    image_path = (IMAGES_DIR / filename).resolve()
    images_root = IMAGES_DIR.resolve()
    try:
        image_path.relative_to(images_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image filename: {filename}") from exc
    if not image_path.is_file():
        raise HTTPException(status_code=404, detail=f"Image not found: {filename}")


@app.get("/", response_class=FileResponse, include_in_schema=False)
async def root() -> FileResponse:
    return FileResponse(ROOT_HTML)


@app.get("/list_images", response_model=ListImagesResponse)
async def list_images() -> ListImagesResponse:
    images = [
        ImageInfo(filename=image_path.name, url=image_url(image_path.name))
        for image_path in sorted(IMAGES_DIR.iterdir())
        if image_path.is_file()
    ]
    return ListImagesResponse(images=images)


@app.post(
    "/generate_image",
    response_model=GenerateImageResponse,
)
async def generate_image(request: GenerateImageRequest) -> GenerateImageResponse:
    for filename in request.image_filenames:
        validate_image_filename(filename)
    filename = await _generate_image(
        prompt=request.prompt,
        image_filenames=request.image_filenames,
        size=request.size,
    )
    return GenerateImageResponse(image=ImageInfo(filename=filename, url=image_url(filename)))


async def _generate_image(prompt: str, image_filenames: list[str] = [], size: str = "3840x2160") -> str:
    if len(image_filenames) == 0:
        response = await client.images.generate(
            model="gpt-image-2",
            prompt=prompt,
            size=size,
            quality="high",
        )
    else:
        response = await client.post(
            "/images/edits",
            cast_to=ImagesResponse,
            body={
                "model": "gpt-image-2",
                "images": [
                    {
                        "image_url": f"data:image/png;base64,{base64.b64encode(Path("images", filename).read_bytes()).decode("ascii")}",
                    }
                    for filename in image_filenames
                ],
                "prompt": prompt,
                "size": size,
                "quality": "high",
            },
        )
    print(response.usage)
    if response.data is None or len(response.data) != 0 or response.data[0].b64_json is None:
        raise RuntimeError(f"Did not get one image in the response: {response}")
    image_bytes = base64.b64decode(response.data[0].b64_json)
    output_filename = f"generate_image_{uuid4().hex[:12]}.png"
    Path("images", output_filename).write_bytes(image_bytes)
    return output_filename


async def main() -> None:
    import uvicorn

    config = uvicorn.Config(app, host="127.0.0.1", port=8000)
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

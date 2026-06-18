import asyncio
import base64
import json
from pathlib import Path

from openai import AsyncOpenAI, DefaultAioHttpClient
from openai.types.images_response import ImagesResponse
from uuid import uuid4

auth_json = json.loads(Path("~/.codex/auth.json").expanduser().read_text())
client = AsyncOpenAI(
        api_key=auth_json["tokens"]["access_token"],
        http_client=DefaultAioHttpClient(),
        base_url="https://chatgpt.com/backend-api/codex",
    )

async def generate_image(prompt: str, image_filenames: list[str] = [], size: str = "3840x2160") -> str:
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
    print(await generate_image("Hello world"))


if __name__ == "__main__":
    asyncio.run(main())

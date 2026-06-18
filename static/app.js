(function () {
  "use strict";

  const STORAGE_KEY = "image-playground.completed-requests.v1";
  const DEFAULT_SIZE = "3840x2160";

  const state = {
    images: [],
    selectedImages: [],
    requests: [],
  };

  const elements = {
    appStatus: document.getElementById("appStatus"),
    clearCompletedButton: document.getElementById("clearCompletedButton"),
    clearSelectionButton: document.getElementById("clearSelectionButton"),
    galleryAlert: document.getElementById("galleryAlert"),
    galleryEmpty: document.getElementById("galleryEmpty"),
    generateButton: document.getElementById("generateButton"),
    imageGallery: document.getElementById("imageGallery"),
    promptForm: document.getElementById("promptForm"),
    promptInput: document.getElementById("promptInput"),
    refreshImagesButton: document.getElementById("refreshImagesButton"),
    requestHistory: document.getElementById("requestHistory"),
    selectedImages: document.getElementById("selectedImages"),
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    state.requests = loadCompletedRequests();
    bindEvents();
    renderSelectedImages();
    renderRequestHistory();
    refreshImages();
    window.setInterval(updateTimers, 1000);
  }

  function bindEvents() {
    elements.promptForm.addEventListener("submit", submitPrompt);
    elements.refreshImagesButton.addEventListener("click", refreshImages);
    elements.clearSelectionButton.addEventListener("click", clearSelection);
    elements.clearCompletedButton.addEventListener("click", clearCompletedRequests);

    elements.imageGallery.addEventListener("click", function (event) {
      const button = event.target.closest("[data-add-image]");
      if (!button) {
        return;
      }
      addSelectedImage(findImage(button.dataset.addImage));
    });

    elements.selectedImages.addEventListener("click", function (event) {
      const button = event.target.closest("[data-remove-selected]");
      if (!button) {
        return;
      }
      removeSelectedImage(button.dataset.removeSelected);
    });

    elements.requestHistory.addEventListener("click", function (event) {
      const replaceButton = event.target.closest("[data-use-request]");
      if (replaceButton) {
        replaceWithRequest(replaceButton.dataset.useRequest);
        return;
      }

      const addResultButton = event.target.closest("[data-add-result]");
      if (addResultButton) {
        addResultImage(addResultButton.dataset.addResult);
      }
    });
  }

  async function refreshImages() {
    setStatus("Loading images...");
    showGalleryAlert("");
    elements.refreshImagesButton.disabled = true;

    try {
      const response = await fetch("/list_images", { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = await response.json();
      state.images = Array.isArray(payload.images) ? payload.images.map(normalizeImage) : [];
      renderGallery();
      renderSelectedImages();
      renderRequestHistory();
      updateStatus();
    } catch (error) {
      showGalleryAlert(error.message || "Unable to load images.");
      setStatus("Unable to load images");
    } finally {
      elements.refreshImagesButton.disabled = false;
    }
  }

  async function submitPrompt(event) {
    event.preventDefault();

    const prompt = elements.promptInput.value.trim();
    if (!prompt) {
      return;
    }

    const request = {
      id: createRequestId(),
      prompt,
      image_filenames: state.selectedImages.map(function (image) {
        return image.filename;
      }),
      status: "in_progress",
      startedAt: Date.now(),
    };

    state.requests.unshift(request);
    renderRequestHistory();
    updateStatus();

    try {
      const response = await fetch("/generate_image", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: request.prompt,
          image_filenames: request.image_filenames,
          size: DEFAULT_SIZE,
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = await response.json();
      request.status = "completed";
      request.completedAt = Date.now();
      request.result = normalizeImage(payload.image);
      saveCompletedRequests();
      renderRequestHistory();
      await refreshImages();
    } catch (error) {
      request.status = "failed";
      request.completedAt = Date.now();
      request.error = error.message || "Generation failed.";
      renderRequestHistory();
      updateStatus();
    } finally {
      elements.promptInput.focus();
    }
  }

  function renderGallery() {
    elements.imageGallery.replaceChildren();
    elements.galleryEmpty.classList.toggle("d-none", state.images.length !== 0);

    state.images.forEach(function (image) {
      const col = document.createElement("div");
      col.className = "col";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-light border p-0 w-100 h-100 text-start overflow-hidden shadow-sm";
      button.dataset.addImage = image.filename;
      button.title = image.filename;

      const img = document.createElement("img");
      img.className = "gallery-image w-100 d-block";
      img.src = image.url;
      img.alt = image.filename;
      img.loading = "lazy";

      const caption = document.createElement("div");
      caption.className = "small text-truncate px-2 py-2 bg-body";
      caption.textContent = image.filename;

      button.append(img, caption);
      col.append(button);
      elements.imageGallery.append(col);
    });
  }

  function renderSelectedImages() {
    elements.selectedImages.replaceChildren();
    elements.clearSelectionButton.disabled = state.selectedImages.length === 0;

    if (state.selectedImages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "text-secondary small py-3";
      empty.textContent = "No selected images";
      elements.selectedImages.append(empty);
      return;
    }

    state.selectedImages.forEach(function (image) {
      const wrapper = document.createElement("div");
      wrapper.className = "position-relative flex-shrink-0";

      const img = document.createElement("img");
      img.className = "selected-image rounded border bg-body-tertiary";
      img.src = resolveImage(image).url;
      img.alt = image.filename;
      img.loading = "lazy";
      img.title = image.filename;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-close position-absolute top-0 end-0 m-1 bg-body rounded-circle";
      button.dataset.removeSelected = image.filename;
      button.setAttribute("aria-label", `Remove ${image.filename}`);

      wrapper.append(img, button);
      elements.selectedImages.append(wrapper);
    });
  }

  function renderRequestHistory() {
    elements.requestHistory.replaceChildren();
    elements.clearCompletedButton.disabled = !state.requests.some(function (request) {
      return request.status === "completed";
    });

    if (state.requests.length === 0) {
      const empty = document.createElement("div");
      empty.className = "text-secondary small";
      empty.textContent = "No requests yet";
      elements.requestHistory.append(empty);
      return;
    }

    state.requests.forEach(function (request) {
      elements.requestHistory.append(createHistoryItem(request));
    });

    updateTimers();
  }

  function createHistoryItem(request) {
    const item = document.createElement("article");
    item.className = "border rounded bg-body p-3 mb-3";

    const top = document.createElement("div");
    top.className = "d-flex align-items-start justify-content-between gap-2 mb-2";

    const prompt = document.createElement("div");
    prompt.className = "fw-semibold text-break";
    prompt.textContent = request.prompt || "Untitled request";

    const badge = document.createElement("span");
    badge.className = statusClass(request.status);
    badge.textContent = statusLabel(request.status);
    top.append(prompt, badge);

    const meta = document.createElement("div");
    meta.className = "small text-secondary mb-2";
    if (request.status === "in_progress") {
      const timer = document.createElement("span");
      timer.dataset.timerStartedAt = String(request.startedAt);
      timer.textContent = "0s";
      meta.append("Running ", timer);
    } else if (request.status === "completed") {
      meta.textContent = `${request.image_filenames.length} source image${request.image_filenames.length === 1 ? "" : "s"}`;
    } else {
      meta.textContent = request.error || "Request failed";
    }

    const preview = createHistoryPreview(request);
    const actions = document.createElement("div");
    actions.className = "d-flex gap-2 mt-3";

    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.className = "btn btn-sm btn-outline-primary flex-fill";
    useButton.dataset.useRequest = request.id;
    useButton.textContent = "Use inputs";

    const addResultButton = document.createElement("button");
    addResultButton.type = "button";
    addResultButton.className = "btn btn-sm btn-outline-secondary flex-fill";
    addResultButton.dataset.addResult = request.id;
    addResultButton.textContent = "Add result";
    addResultButton.disabled = !request.result;

    actions.append(useButton, addResultButton);
    item.append(top, meta, preview, actions);
    return item;
  }

  function createHistoryPreview(request) {
    const preview = document.createElement("div");

    if (request.result) {
      preview.append(createResultImage(resolveImage(request.result)));
    }

    if (request.image_filenames.length) {
      const row = document.createElement("div");
      row.className = `history-source-strip d-flex gap-1 overflow-auto${request.result ? " mt-2" : ""}`;

      request.image_filenames.forEach(function (filename) {
        const image = resolveImage({ filename });
        row.append(createSmallImage(image, "Source"));
      });

      preview.append(row);
    }

    if (!request.image_filenames.length && !request.result) {
      const empty = document.createElement("div");
      empty.className = "small text-secondary";
      empty.textContent = "Text only";
      preview.append(empty);
    }

    return preview;
  }

  function createResultImage(image) {
    const img = document.createElement("img");
    img.className = "history-result-image w-100 d-block rounded border bg-body-tertiary";
    img.src = image.url;
    img.alt = `Result: ${image.filename}`;
    img.loading = "lazy";
    img.title = image.filename;
    return img;
  }

  function createSmallImage(image, label) {
    const img = document.createElement("img");
    img.className = "history-source-thumb rounded border bg-body-tertiary flex-shrink-0";
    img.src = image.url;
    img.alt = `${label}: ${image.filename}`;
    img.loading = "lazy";
    img.title = image.filename;
    return img;
  }

  function addSelectedImage(image) {
    if (!image || state.selectedImages.some(function (selected) {
      return selected.filename === image.filename;
    })) {
      return;
    }

    state.selectedImages.push(resolveImage(image));
    renderSelectedImages();
  }

  function addResultImage(requestId) {
    const request = findRequest(requestId);
    if (!request || !request.result) {
      return;
    }
    addSelectedImage(request.result);
  }

  function replaceWithRequest(requestId) {
    const request = findRequest(requestId);
    if (!request) {
      return;
    }

    elements.promptInput.value = request.prompt || "";
    state.selectedImages = request.image_filenames.map(function (filename) {
      return resolveImage({ filename });
    });
    renderSelectedImages();
    elements.promptInput.focus();
  }

  function removeSelectedImage(filename) {
    state.selectedImages = state.selectedImages.filter(function (image) {
      return image.filename !== filename;
    });
    renderSelectedImages();
  }

  function clearSelection() {
    state.selectedImages = [];
    renderSelectedImages();
  }

  function clearCompletedRequests() {
    state.requests = state.requests.filter(function (request) {
      return request.status !== "completed";
    });
    saveCompletedRequests();
    renderRequestHistory();
  }

  function findImage(filename) {
    return state.images.find(function (image) {
      return image.filename === filename;
    }) || resolveImage({ filename });
  }

  function findRequest(requestId) {
    return state.requests.find(function (request) {
      return request.id === requestId;
    });
  }

  function normalizeImage(image) {
    const filename = image && typeof image.filename === "string" ? image.filename : "";
    const url = image && typeof image.url === "string" ? image.url : imageUrl(filename);
    return { filename, url };
  }

  function resolveImage(image) {
    const normalized = normalizeImage(image);
    const current = findCurrentImage(normalized.filename);
    return current || normalized;
  }

  function findCurrentImage(filename) {
    return state.images.find(function (image) {
      return image.filename === filename;
    });
  }

  function imageUrl(filename) {
    return `/images/${encodeURIComponent(filename)}`;
  }

  function setStatus(message) {
    elements.appStatus.textContent = message;
  }

  function updateStatus() {
    const activeCount = state.requests.filter(function (request) {
      return request.status === "in_progress";
    }).length;

    if (activeCount > 0) {
      setStatus(`${activeCount} generation${activeCount === 1 ? "" : "s"} running`);
      return;
    }

    setStatus(`${state.images.length} image${state.images.length === 1 ? "" : "s"}`);
  }

  function showGalleryAlert(message) {
    elements.galleryAlert.textContent = message;
    elements.galleryAlert.classList.toggle("d-none", !message);
  }

  function updateTimers() {
    document.querySelectorAll("[data-timer-started-at]").forEach(function (timer) {
      const startedAt = Number(timer.dataset.timerStartedAt);
      if (!Number.isFinite(startedAt)) {
        return;
      }
      const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      timer.textContent = `${seconds}s`;
    });
  }

  function loadCompletedRequests() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter(function (request) {
          return request && request.status === "completed";
        })
        .map(function (request) {
          return {
            id: request.id || createRequestId(),
            prompt: String(request.prompt || ""),
            image_filenames: Array.isArray(request.image_filenames) ? request.image_filenames : [],
            status: "completed",
            startedAt: Number(request.startedAt) || Date.now(),
            completedAt: Number(request.completedAt) || Date.now(),
            result: request.result ? normalizeImage(request.result) : null,
          };
        });
    } catch (error) {
      console.warn("Unable to load request history", error);
      return [];
    }
  }

  function saveCompletedRequests() {
    const completed = state.requests.filter(function (request) {
      return request.status === "completed";
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
  }

  async function readErrorMessage(response) {
    try {
      const payload = await response.json();
      if (typeof payload.detail === "string") {
        return payload.detail;
      }
      if (payload.detail) {
        return JSON.stringify(payload.detail);
      }
    } catch (error) {
      return response.statusText || "Request failed.";
    }
    return response.statusText || "Request failed.";
  }

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function statusClass(status) {
    if (status === "completed") {
      return "badge text-bg-success flex-shrink-0";
    }
    if (status === "failed") {
      return "badge text-bg-danger flex-shrink-0";
    }
    return "badge text-bg-primary flex-shrink-0";
  }

  function statusLabel(status) {
    if (status === "completed") {
      return "Done";
    }
    if (status === "failed") {
      return "Failed";
    }
    return "Running";
  }
})();

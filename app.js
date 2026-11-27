
const $ = s => document.querySelector(s);

const pages = ["home", "images", "videos", "edit", "characters", "gallery"];

function showPage(id) {
  pages.forEach(p => $("#" + p)?.classList.toggle("active", p === id));

  document.querySelectorAll("[data-page]").forEach(b =>
    b.classList.toggle("selected", b.dataset.page === id)
  );

  window.scrollTo({ top: 0, behavior: "smooth" });

  if (id === "gallery") renderGallery();
}

document.querySelectorAll("[data-page]").forEach(b =>
  b.addEventListener("click", () => showPage(b.dataset.page))
);

function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2300);
}

const get = (k, d = []) => {
  try {
    return JSON.parse(localStorage.getItem(k)) || d;
  } catch {
    return d;
  }
};

const set = (k, v) =>
  localStorage.setItem(k, JSON.stringify(v));


// =====================================
// تحسين أوصاف الصور
// =====================================

let originalImagePrompt = null;
let promptIsEnhanced = false;

const realismInstructions =
  "\n\nPhotorealistic professional photograph. Preserve the exact subject, appearance, clothing, pose, objects and background requested by the user. Natural anatomy, realistic skin and hair texture, accurate lighting and shadows, natural colors, sharp details. No cartoon, anime, CGI, distorted anatomy, extra fingers or unrequested objects.";

function setupPromptEnhancer() {
  const field = $("#imagePrompt");

  if (!field || $("#promptTools")) return;

  const tools = document.createElement("div");
  tools.id = "promptTools";
  tools.style.cssText =
    "display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;";

  const enhanceButton = document.createElement("button");
  enhanceButton.type = "button";
  enhanceButton.textContent = "✨ تحسين واقعية الوصف";
  enhanceButton.style.cssText =
    "padding:12px;border:0;border-radius:10px;background:#7048e8;color:white;font-weight:bold;";

  const restoreButton = document.createElement("button");
  restoreButton.type = "button";
  restoreButton.textContent = "↩ استعادة الوصف الأصلي";
  restoreButton.style.cssText =
    "padding:12px;border:1px solid #888;border-radius:10px;background:transparent;color:inherit;";

  enhanceButton.addEventListener("click", () => {
    const current = field.value.trim();

    if (!current) {
      toast("اكتب وصف الصورة أولاً");
      return;
    }

    if (promptIsEnhanced) {
      toast("الوصف محسّن بالفعل");
      return;
    }

    if (current.length > 2048) {
      toast("الوصف يتجاوز حد 2048 حرفاً");
      return;
    }

    const remaining = 2048 - current.length;

    if (remaining < 40) {
      toast("الوصف طويل جداً");
      return;
    }

    originalImagePrompt = current;
    field.value = current + realismInstructions.slice(0, remaining);
    promptIsEnhanced = true;

    toast("تم تحسين تعليمات الواقعية");
  });

  restoreButton.addEventListener("click", () => {
    if (originalImagePrompt !== null) {
      field.value = originalImagePrompt;
    }

    originalImagePrompt = null;
    promptIsEnhanced = false;

    toast("تم استعادة الوصف الأصلي");
  });

  tools.append(enhanceButton, restoreButton);
  field.insertAdjacentElement("afterend", tools);
}

setupPromptEnhancer();


// =====================================
// قاعدة بيانات الصور
// =====================================

let dbPromise;

function openImageDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("AIMASTER_DB", 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("images")) {
        db.createObjectStore("images", { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

async function saveImage(item) {
  const db = await openImageDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getImages() {
  const db = await openImageDB();

  return new Promise((resolve, reject) => {
    const request = db.transaction("images", "readonly")
      .objectStore("images").getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}


// =====================================
// توليد الصور عبر Cloudflare Workers AI
// =====================================

$("#imageDemo")?.addEventListener("click", async () => {
  const prompt = $("#imagePrompt")?.value.trim();

  if (!prompt) {
    toast("اكتب وصف الصورة أولاً");
    return;
  }

  if (prompt.length > 2048) {
    toast("الوصف يجب ألا يتجاوز 2048 حرفاً");
    return;
  }

  const originalPrompt =
    originalImagePrompt !== null ? originalImagePrompt : prompt;

  const btn = $("#imageDemo");
  const msg = $("#imageMsg");

  btn.disabled = true;

  if (msg) msg.textContent = "جارٍ توليد الصورة، يرجى الانتظار...";

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      throw new Error("استجابة الخادم غير صحيحة");
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "فشل توليد الصورة");
    }

    if (!data.image || !data.image.startsWith("data:image/")) {
      throw new Error("لم تصل صورة صالحة");
    }

    const imageItem = {
      id: Date.now().toString(),
      prompt: originalPrompt,
      enhancedPrompt: prompt !== originalPrompt ? prompt : null,
      image: data.image,
      ratio: $("#ratio")?.value || "9:16 عمودي",
      date: new Date().toLocaleString("ar")
    };

    await saveImage(imageItem);

    let img = $("#generatedImage");

    if (!img) {
      img = document.createElement("img");
      img.id = "generatedImage";
      img.style.cssText =
        "display:block;width:100%;max-width:600px;margin:15px auto;border-radius:12px;";

      if (msg) msg.after(img);
    }

    img.src = data.image;

    if (msg) msg.textContent = "تم توليد الصورة وحفظها بنجاح!";

    toast("تم حفظ الصورة في المعرض");

  } catch (error) {
    if (msg) msg.textContent = "حدث خطأ: " + error.message;
    toast("تعذر توليد الصورة");

  } finally {
    btn.disabled = false;
  }
});


// =====================================
// معاينة صورة الفيديو
// =====================================

let videoImageURL = null;

$("#videoImage")?.addEventListener("change", e => {
  const file = e.target.files?.[0];
  const preview = $("#videoPreview");
  const msg = $("#videoMsg");

  if (!file || !preview) return;

  if (!file.type.startsWith("image/")) {
    toast("يرجى اختيار ملف صورة صالح");
    e.target.value = "";
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    toast("حجم الصورة يجب ألا يتجاوز 10 ميغابايت");
    e.target.value = "";
    return;
  }

  if (videoImageURL) URL.revokeObjectURL(videoImageURL);

  videoImageURL = URL.createObjectURL(file);
  preview.src = videoImageURL;
  preview.classList.remove("hidden");

  if (msg) msg.textContent = "تم اختيار الصورة بنجاح.";

  toast("تم تحميل الصورة ومعاينتها");
});


// =====================================
// حفظ إعدادات الفيديو
// =====================================

$("#videoDemo")?.addEventListener("click", () => {
  const prompt = $("#videoPrompt")?.value.trim();
  const engine = $("#videoEngine")?.value || "auto";
  const duration = $("#videoDuration")?.value || "8";
  const imageFile = $("#videoImage")?.files?.[0] || null;

  if (!prompt) {
    toast("اكتب وصف الفيديو أولاً");
    return;
  }

  const items = get("ai_master_prompts");

  items.unshift({
    type: "فيديو",
    prompt,
    engine,
    duration,
    imageName: imageFile ? imageFile.name : null,
    date: new Date().toLocaleString("ar")
  });

  set("ai_master_prompts", items);

  const msg = $("#videoMsg");

  if (msg) {
    msg.textContent =
      "تم حفظ إعدادات الفيديو. استخدم Google Flow لتوليد الفيديو.";
  }

  toast("تم حفظ إعدادات الفيديو");
});


// =====================================
// معاينة الصورة المراد تعديلها
// =====================================

let editImageURL = null;

$("#editFile")?.addEventListener("change", e => {
  const file = e.target.files?.[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    toast("يرجى اختيار صورة صالحة");
    e.target.value = "";
    return;
  }

  if (editImageURL) URL.revokeObjectURL(editImageURL);

  editImageURL = URL.createObjectURL(file);

  const preview = $("#editPreview");

  if (preview) {
    preview.src = editImageURL;
    preview.classList.remove("hidden");
  }

  toast("تم اختيار الصورة");
});


// =====================================
// حفظ الشخصيات
// =====================================

$("#saveCharacter")?.addEventListener("click", () => {
  const name = $("#charName")?.value.trim();
  const desc = $("#charDesc")?.value.trim();

  if (!name || !desc) {
    toast("أدخل اسم الشخصية ووصفها");
    return;
  }

  const characters = get("ai_master_characters");
  characters.push({ name, desc });

  set("ai_master_characters", characters);

  $("#charName").value = "";
  $("#charDesc").value = "";

  renderCharacters();
  toast("تم حفظ الشخصية على هذا الجهاز");
});


// =====================================
// حماية النصوص المعروضة
// =====================================

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}


// =====================================
// عرض الشخصيات
// =====================================

function renderCharacters() {
  const characters = get("ai_master_characters");
  const container = $("#characterList");

  if (!container) return;

  container.innerHTML = characters.length
    ? characters.map(item =>
        `<article class="character">
          <b>${escapeHtml(item.name)}</b>
          <p>${escapeHtml(item.desc)}</p>
        </article>`
      ).join("")
    : "<p class='hint'>لم تحفظ أي شخصية بعد.</p>";
}


// =====================================
// حذف الصور من قاعدة البيانات
// =====================================

async function deleteImage(id) {
  const db = await openImageDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").delete(id);

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}


// =====================================
// نافذة عرض الصور والفيديوهات
// =====================================

let activeModalURL = null;

function closeMediaModal() {
  const modal = $("#mediaModal");

  if (modal) modal.remove();

  if (activeModalURL) {
    URL.revokeObjectURL(activeModalURL);
    activeModalURL = null;
  }
}

function openMediaModal(type, source, caption = "") {
  closeMediaModal();

  const modal = document.createElement("div");
  modal.id = "mediaModal";
  modal.className = "media-modal open";

  const backdrop = document.createElement("div");
  backdrop.className = "media-modal-backdrop";
  backdrop.addEventListener("click", closeMediaModal);

  const dialog = document.createElement("div");
  dialog.className = "media-modal-dialog";

  const close = document.createElement("button");
  close.className = "media-modal-close";
  close.textContent = "✕";
  close.type = "button";
  close.addEventListener("click", closeMediaModal);

  const content = document.createElement("div");
  content.className = "media-modal-content";

  let media;

  if (type === "video") {
    media = document.createElement("video");
    media.controls = true;
    media.playsInline = true;
    media.autoplay = true;

    if (source instanceof Blob) {
      activeModalURL = URL.createObjectURL(source);
      media.src = activeModalURL;
    } else {
      media.src = source;
    }

  } else {
    media = document.createElement("img");
    media.alt = caption || "صورة من المعرض";
    media.src = source;
  }

  media.className = "media-modal-media";

  const text = document.createElement("p");
  text.className = "media-modal-caption";
  text.textContent = caption;

  content.append(media, text);
  dialog.append(close, content);
  modal.append(backdrop, dialog);

  document.body.appendChild(modal);
}


// =====================================
// تنزيل الملفات ومشاركتها
// =====================================

function downloadMedia(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "AI-MASTER";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function shareMedia(blob, filename, title) {
  try {
    const file = new File([blob], filename, {
      type: blob.type || "application/octet-stream"
    });

    if (
      navigator.share &&
      navigator.canShare &&
      navigator.canShare({ files: [file] })
    ) {
      await navigator.share({
        files: [file],
        title: title || "AI MASTER"
      });
    } else {
      toast("المشاركة غير مدعومة؛ سيتم تنزيل الملف");
      const url = URL.createObjectURL(blob);
      downloadMedia(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      toast("تعذرت مشاركة الملف");
    }
  }
}


// =====================================
// تبويبات المعرض
// =====================================

let currentGalleryFilter = "all";

function setupGalleryTabs() {
  const gallery = $("#galleryItems");

  if (!gallery) return;

  const parent = gallery.parentElement;

  if ($("#galleryTabs")) return;

  const tabs = document.createElement("div");
  tabs.id = "galleryTabs";
  tabs.className = "gallery-tabs";

  const options = [
    ["all", "الكل"],
    ["images", "الصور"],
    ["videos", "الفيديوهات"]
  ];

  options.forEach(([value, label]) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      "gallery-tab" + (value === currentGalleryFilter ? " active" : "");

    button.textContent = label;

    button.addEventListener("click", () => {
      currentGalleryFilter = value;

      tabs.querySelectorAll("button").forEach(item => {
        item.classList.toggle("active", item === button);
      });

      applyGalleryFilter();
    });

    tabs.appendChild(button);
  });

  parent.insertBefore(tabs, gallery);
}

function applyGalleryFilter() {
  const gallery = $("#galleryItems");

  if (!gallery) return;

  gallery.querySelectorAll("[data-gallery-kind]").forEach(card => {
    const kind = card.dataset.galleryKind;

    card.hidden =
      currentGalleryFilter !== "all" &&
      currentGalleryFilter !== kind;
  });

  const videoSection = $("#savedVideoSection");

  if (videoSection) {
    videoSection.hidden = currentGalleryFilter === "images";
  }
}


// =====================================
// عرض المعرض المطوّر
// =====================================

async function renderGallery() {
  const container = $("#galleryItems");

  if (!container) return;

  setupGalleryTabs();

  container.innerHTML =
    "<p class='hint'>جارٍ تحميل المعرض...</p>";

  try {
    const [images, videos] = await Promise.all([
      getImages(),
      readVideoFiles()
    ]);

    const prompts = get("ai_master_prompts");

    images.sort((a, b) => Number(b.id) - Number(a.id));

    container.innerHTML = "";

    if (!images.length && !prompts.length && !videos.length) {
      container.innerHTML =
        "<p class='hint'>لا توجد أعمال محفوظة بعد.</p>";
      applyGalleryFilter();
      return;
    }

    images.forEach(item => {
      const card = document.createElement("article");
      card.className = "gallery-card";
      card.dataset.galleryKind = "images";

      const image = document.createElement("img");
      image.src = item.image;
      image.alt = item.prompt || "صورة مولّدة";
      image.className = "gallery-thumb";

      image.addEventListener("click", () => {
        openMediaModal("image", item.image, item.prompt);
      });

      const title = document.createElement("b");
      title.textContent = "🖼️ صورة مولّدة";

      const description = document.createElement("p");
      description.textContent = item.prompt || "";

      const date = document.createElement("small");
      date.textContent = item.date || "";

      const actions = document.createElement("div");
      actions.className = "gallery-actions";

      const openButton = document.createElement("button");
      openButton.className = "gallery-action";
      openButton.textContent = "تكبير";
      openButton.onclick = () =>
        openMediaModal("image", item.image, item.prompt);

      const downloadButton = document.createElement("button");
      downloadButton.className = "gallery-action";
      downloadButton.textContent = "تنزيل";
      downloadButton.onclick = () =>
        downloadMedia(item.image, "AI-MASTER-" + item.id + ".jpg");

      const shareButton = document.createElement("button");
      shareButton.className = "gallery-action";
      shareButton.textContent = "مشاركة";
      shareButton.onclick = async () => {
        try {
          const response = await fetch(item.image);
          const blob = await response.blob();
          await shareMedia(blob, "AI-MASTER-" + item.id + ".jpg", "AI MASTER");
        } catch {
          toast("تعذرت مشاركة الصورة");
        }
      };

      const deleteButton = document.createElement("button");
      deleteButton.className = "gallery-action danger";
      deleteButton.textContent = "حذف";
      deleteButton.onclick = async () => {
        if (!confirm("هل تريد حذف هذه الصورة نهائياً؟")) return;

        try {
          await deleteImage(item.id);
          toast("تم حذف الصورة");
          renderGallery();
        } catch {
          toast("تعذر حذف الصورة");
        }
      };

      actions.append(
        openButton,
        downloadButton,
        shareButton,
        deleteButton
      );

      card.append(image, title, description, date, actions);

      if (item.enhancedPrompt) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "عرض الوصف المحسّن";

        const text = document.createElement("p");
        text.textContent = item.enhancedPrompt;

        details.append(summary, text);
        card.appendChild(details);
      }

      container.appendChild(card);
    });

    prompts.forEach(item => {
      const card = document.createElement("article");
      card.className = "gallery-card prompt-card";
      card.dataset.galleryKind = "prompts";

      const title = document.createElement("b");
      title.textContent = item.type || "وصف محفوظ";

      const description = document.createElement("p");
      description.textContent = item.prompt || "";

      const date = document.createElement("small");
      date.textContent = item.date || "";

      card.append(title, description, date);
      container.appendChild(card);
    });

    await renderSavedVideos(videos);
    applyGalleryFilter();

  } catch (error) {
    container.innerHTML =
      "<p class='hint'>تعذر تحميل المعرض: " +
      escapeHtml(error.message) + "</p>";
  }
}


// =====================================
// معلومات المنصة
// =====================================

$("#themeInfo")?.addEventListener("click", () =>
  toast("AI MASTER — منصتك الخاصة")
);


// =====================================
// قاعدة بيانات الفيديوهات
// =====================================

const FLOW_URL = "https://labs.google/fx/tools/flow";

let videoDBPromise = null;

function openVideoDB() {
  if (videoDBPromise) return videoDBPromise;

  videoDBPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("AIMASTER_VIDEO_DB", 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("videos")) {
        db.createObjectStore("videos", { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => {
      videoDBPromise = null;
      reject(request.error);
    };
  });

  return videoDBPromise;
}

async function saveVideoFile(item) {
  const db = await openVideoDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("videos", "readwrite");

    tx.objectStore("videos").put(item);

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function readVideoFiles() {
  const db = await openVideoDB();

  return new Promise((resolve, reject) => {
    const request = db.transaction("videos", "readonly")
      .objectStore("videos")
      .getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function removeVideoFile(id) {
  const db = await openVideoDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("videos", "readwrite");

    tx.objectStore("videos").delete(id);

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}


// =====================================
// أدوات Google Flow
// =====================================

function setupFlowStudio() {
  const button = $("#videoDemo");

  if (!button || $("#flowStudioTools")) return;

  const panel = document.createElement("div");
  panel.id = "flowStudioTools";

  panel.style.cssText =
    "display:grid;gap:12px;margin:15px 0;padding:14px;border:1px solid #7048e8;border-radius:12px;";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "📋 نسخ وصف الفيديو";

  const flowButton = document.createElement("button");
  flowButton.type = "button";
  flowButton.textContent = "🌐 فتح Google Flow";

  const uploadTitle = document.createElement("b");
  uploadTitle.textContent = "استيراد فيديو من الهاتف";

  const uploadHint = document.createElement("small");
  uploadHint.textContent =
    "اختر فيديو قمت بتنزيله من Google Flow لحفظه في معرضك.";

  const upload = document.createElement("input");
  upload.type = "file";
  upload.accept = "video/*";
  upload.id = "videoImportFile";

  [copyButton, flowButton].forEach(button => {
    button.style.cssText =
      "padding:13px;border:0;border-radius:10px;background:#7048e8;color:white;font-weight:bold;";
  });

  panel.append(
    copyButton,
    flowButton,
    uploadTitle,
    uploadHint,
    upload
  );

  button.insertAdjacentElement("afterend", panel);

  copyButton.addEventListener("click", async () => {
    const prompt = $("#videoPrompt")?.value.trim();

    if (!prompt) {
      toast("اكتب وصف الفيديو أولاً");
      return;
    }

    const duration = $("#videoDuration")?.value || "8";

    const fullPrompt =
      prompt + "\n\nTarget video duration: " + duration + " seconds.";

    try {
      await navigator.clipboard.writeText(fullPrompt);
      toast("تم نسخ وصف الفيديو بنجاح");
    } catch {
      const field = document.createElement("textarea");
      field.value = fullPrompt;

      document.body.appendChild(field);
      field.select();

      const copied = document.execCommand("copy");
      field.remove();

      toast(copied ? "تم نسخ الوصف" : "تعذر النسخ");
    }
  });

  flowButton.addEventListener("click", () => {
    window.open(FLOW_URL, "_blank", "noopener");
    toast("افتح Google Flow لإنشاء الفيديو");
  });

  upload.addEventListener("change", async () => {
    const file = upload.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("video/")) {
      toast("الملف المختار ليس فيديو");
      upload.value = "";
      return;
    }

    if (file.size > 150 * 1024 * 1024) {
      toast("حجم الفيديو أكبر من 150 ميغابايت");
      upload.value = "";
      return;
    }

    try {
      await saveVideoFile({
        id: "video-" + Date.now(),
        name: file.name,
        blob: file,
        prompt: $("#videoPrompt")?.value.trim() || "",
        date: new Date().toLocaleString("ar")
      });

      toast("تم حفظ الفيديو في AI MASTER");

      if ($("#videosMsg")) {
        $("#videosMsg").textContent = "تم حفظ الفيديو بنجاح.";
      }

      upload.value = "";

      await renderGallery();

    } catch (error) {
      console.error(error);
      toast("تعذر حفظ الفيديو. تحقق من مساحة الهاتف.");
    }
  });
}


// =====================================
// إدارة روابط معاينة الفيديو
// =====================================

const galleryVideoURLs = new Set();

function clearGalleryVideoURLs() {
  galleryVideoURLs.forEach(url => URL.revokeObjectURL(url));
  galleryVideoURLs.clear();
}


// =====================================
// عرض الفيديوهات داخل المعرض
// =====================================

async function renderSavedVideos(existingVideos = null) {
  const gallery = $("#galleryItems");

  if (!gallery) return;

  closeMediaModal();
  clearGalleryVideoURLs();

  let section = $("#savedVideoSection");

  if (!section) {
    section = document.createElement("section");
    section.id = "savedVideoSection";
    section.className = "saved-video-section";
    gallery.appendChild(section);
  }

  section.innerHTML = "<h3>🎬 فيديوهاتي المحفوظة</h3>";

  try {
    const videos = existingVideos || await readVideoFiles();

    if (!videos.length) {
      section.innerHTML +=
        "<p class='hint'>لم تحفظ أي فيديو بعد.</p>";
      applyGalleryFilter();
      return;
    }

    videos.sort((a, b) =>
      String(b.id).localeCompare(String(a.id))
    );

    videos.forEach(item => {
      const card = document.createElement("article");
      card.className = "gallery-card video-gallery-card";

      const player = document.createElement("video");
      player.controls = true;
      player.playsInline = true;
      player.preload = "metadata";
      player.className = "gallery-video";

      const videoURL = URL.createObjectURL(item.blob);
      galleryVideoURLs.add(videoURL);
      player.src = videoURL;

      const name = document.createElement("p");
      name.textContent = item.name || "فيديو محفوظ";

      const date = document.createElement("small");
      date.textContent = item.date || "";

      const actions = document.createElement("div");
      actions.className = "gallery-actions";

      const openButton = document.createElement("button");
      openButton.className = "gallery-action";
      openButton.textContent = "تكبير";
      openButton.onclick = () =>
        openMediaModal("video", item.blob, item.name);

      const downloadButton = document.createElement("button");
      downloadButton.className = "gallery-action";
      downloadButton.textContent = "تنزيل";
      downloadButton.onclick = () =>
        downloadMedia(videoURL, item.name || "AI-MASTER-video.mp4");

      const shareButton = document.createElement("button");
      shareButton.className = "gallery-action";
      shareButton.textContent = "مشاركة";
      shareButton.onclick = () =>
        shareMedia(
          item.blob,
          item.name || "AI-MASTER-video.mp4",
          "AI MASTER"
        );

      const deleteButton = document.createElement("button");
      deleteButton.className = "gallery-action danger";
      deleteButton.textContent = "حذف";

      deleteButton.onclick = async () => {
        if (!confirm("هل تريد حذف هذا الفيديو نهائياً؟")) return;

        try {
          await removeVideoFile(item.id);
          toast("تم حذف الفيديو");
          await renderGallery();

        } catch {
          toast("تعذر حذف الفيديو");
        }
      };

      actions.append(
        openButton,
        downloadButton,
        shareButton,
        deleteButton
      );

      card.append(player, name, date, actions);

      if (item.prompt) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "عرض وصف الفيديو";

        const description = document.createElement("p");
        description.textContent = item.prompt;

        details.append(summary, description);
        card.appendChild(details);
      }

      section.appendChild(card);
    });

    applyGalleryFilter();

  } catch (error) {
    console.error(error);

    section.innerHTML +=
      "<p class='hint'>تعذر تحميل الفيديوهات المحفوظة.</p>";
  }
}


// =====================================
// تشغيل وظائف AI MASTER
// =====================================

setupFlowStudio();

renderCharacters();
renderGallery();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

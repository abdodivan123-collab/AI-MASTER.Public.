/* AI MASTER — app.js
   يحافظ على واجهة المشروع الحالية ولا يغيّر API توليد الصور.
*/
"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const PAGE_IDS = ["home", "images", "videos", "edit", "characters", "gallery"];
const IMAGE_DB_NAME = "AIMASTER_DB";
const VIDEO_DB_NAME = "AIMASTER_VIDEO_DB";
const FLOW_URL = "https://labs.google/fx/tools/flow";
const IMAGE_STORE = "images";
const VIDEO_STORE = "videos";

let imageDBPromise = null;
let videoDBPromise = null;
let videoImageURL = null;
let editImageURL = null;
let activeModalURL = null;
let galleryVideoURLs = new Set();
let currentGalleryFilter = "all";
let originalImagePrompt = null;
let enhancedImagePrompt = null;
let promptIsEnhanced = false;
let toastTimer = null;

function toast(message) {
  const node = $("#toast");
  if (!node) return;
  node.textContent = String(message);
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
}

function readStorage(key, fallback = []) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch (error) {
    console.warn("تعذر قراءة التخزين المحلي:", key, error);
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error("تعذر الحفظ محلياً:", error);
    toast("مساحة التخزين ممتلئة أو غير متاحة");
    return false;
  }
}

function showPage(id) {
  if (!PAGE_IDS.includes(id)) return;

  PAGE_IDS.forEach(page => {
    const section = $("#" + page);
    if (section) section.classList.toggle("active", page === id);
  });

  $$("[data-page]").forEach(button => {
    const selected = button.dataset.page === id;
    button.classList.toggle("selected", selected);
    if (button.classList.contains("nav-item")) {
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });

  if (id === "gallery") renderGallery();
  if (id === "home") renderRecent();
  if (id === "characters") renderCharacters();
}

$$("[data-page]").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});

$("#themeInfo")?.addEventListener("click", () => {
  toast("AI MASTER — استوديوك الخاص للصور والفيديو");
});

// ---------- IndexedDB helpers ----------
function openDatabase(name, storeName, cacheSetter) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      cacheSetter(null);
      reject(request.error || new Error("تعذر فتح قاعدة البيانات"));
    };
  });
}

function openImageDB() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("التخزين المحلي غير مدعوم"));
  if (!imageDBPromise) imageDBPromise = openDatabase(IMAGE_DB_NAME, IMAGE_STORE, value => imageDBPromise = value);
  return imageDBPromise;
}

function openVideoDB() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("التخزين المحلي غير مدعوم"));
  if (!videoDBPromise) videoDBPromise = openDatabase(VIDEO_DB_NAME, VIDEO_STORE, value => videoDBPromise = value);
  return videoDBPromise;
}

async function putRecord(dbPromise, storeName, item) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error || new Error("تعذر الحفظ"));
    tx.onabort = () => reject(tx.error || new Error("تم إلغاء الحفظ"));
  });
}

async function getAllRecords(dbPromise, storeName) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("تعذر قراءة البيانات"));
  });
}

async function deleteRecord(dbPromise, storeName, id) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("تعذر الحذف"));
  });
}

const saveImage = item => putRecord(openImageDB(), IMAGE_STORE, item);
const getImages = () => getAllRecords(openImageDB(), IMAGE_STORE);
const deleteImage = id => deleteRecord(openImageDB(), IMAGE_STORE, id);
const saveVideoFile = item => putRecord(openVideoDB(), VIDEO_STORE, item);
const readVideoFiles = () => getAllRecords(openVideoDB(), VIDEO_STORE);
const removeVideoFile = id => deleteRecord(openVideoDB(), VIDEO_STORE, id);

// ---------- Prompt enhancement ----------
const realismInstructions =
  "\n\nPhotorealistic professional photograph. Preserve the requested subject, appearance, clothing, pose, objects and background. Natural anatomy, realistic skin and hair texture, accurate lighting and shadows, natural colors, sharp details. No cartoon, anime, CGI, distorted anatomy, extra fingers or unrequested objects.";

function setupPromptEnhancer() {
  const field = $("#imagePrompt");
  if (!field || $("#promptTools")) return;

  const tools = document.createElement("div");
  tools.id = "promptTools";
  tools.className = "prompt-tools";

  const enhance = document.createElement("button");
  enhance.type = "button";
  enhance.className = "secondary";
  enhance.textContent = "✨ تحسين واقعية الوصف";

  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "secondary";
  restore.textContent = "↩ استعادة الوصف الأصلي";

  field.addEventListener("input", () => {
    promptIsEnhanced = enhancedImagePrompt !== null && field.value === enhancedImagePrompt;
  });

  enhance.addEventListener("click", () => {
    let current = field.value.trim();
    if (!current) return toast("اكتب وصف الصورة أولاً");

    // إذا كان النص الحالي هو النسخة المحسّنة، لا نكرر التعليمات.
    if (enhancedImagePrompt !== null && current === enhancedImagePrompt) {
      return toast("الوصف محسّن بالفعل");
    }

    // إذا عدّل المستخدم النسخة المحسّنة، أزل ذيل التعليمات قبل إعادة التحسين.
    if (current.endsWith(realismInstructions.trim())) {
      current = current.slice(0, -realismInstructions.trim().length).trim();
    }

    const candidate = current + realismInstructions;
    if (candidate.length > 2048) {
      return toast("الوصف طويل جداً؛ اختصره قليلاً قبل التحسين");
    }

    if (originalImagePrompt === null) originalImagePrompt = current;
    field.value = candidate;
    enhancedImagePrompt = candidate;
    promptIsEnhanced = true;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    toast("تم تحسين واقعية الوصف");
  });

  restore.addEventListener("click", () => {
    if (originalImagePrompt === null) return toast("لا يوجد وصف أصلي محفوظ للاستعادة");
    field.value = originalImagePrompt;
    originalImagePrompt = null;
    enhancedImagePrompt = null;
    promptIsEnhanced = false;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    toast("تمت استعادة الوصف الأصلي");
  });

  tools.append(enhance, restore);
  field.insertAdjacentElement("afterend", tools);
}

// ---------- Characters ----------
function getCharacters() {
  const data = readStorage("ai_master_characters", []);
  return Array.isArray(data) ? data.filter(item => item && typeof item === "object") : [];
}

function renderCharacterSelector() {
  const select = $("#imageCharacter");
  if (!select) return;

  const previous = select.value;
  const characters = getCharacters();
  select.innerHTML = '<option value="">بدون شخصية</option>';

  characters.forEach((character, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = character.name || `شخصية ${index + 1}`;
    select.appendChild(option);
  });

  if (previous !== "" && characters[Number(previous)]) select.value = previous;
}

function renderCharacters() {
  const container = $("#characterList");
  if (!container) return;
  const characters = getCharacters();
  container.replaceChildren();

  if (!characters.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "لم تحفظ أي شخصية بعد.";
    container.appendChild(empty);
    return;
  }

  characters.forEach((character, index) => {
    const card = document.createElement("article");
    card.className = "character";

    const name = document.createElement("b");
    name.textContent = character.name || `شخصية ${index + 1}`;

    const description = document.createElement("p");
    description.textContent = character.desc || "";

    const actions = document.createElement("div");
    actions.className = "gallery-actions";

    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.className = "gallery-action";
    useButton.textContent = "استخدام في الصور";
    useButton.addEventListener("click", () => {
      renderCharacterSelector();
      const select = $("#imageCharacter");
      if (select) select.value = String(index);
      showPage("images");
      toast("تم اختيار الشخصية");
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "gallery-action danger";
    deleteButton.textContent = "حذف";
    deleteButton.addEventListener("click", () => {
      if (!confirm("هل تريد حذف هذه الشخصية؟")) return;
      const updated = getCharacters();
      updated.splice(index, 1);
      if (writeStorage("ai_master_characters", updated)) {
        renderCharacters();
        renderCharacterSelector();
        toast("تم حذف الشخصية");
      }
    });

    actions.append(useButton, deleteButton);
    card.append(name, description, actions);
    container.appendChild(card);
  });
}

$("#saveCharacter")?.addEventListener("click", () => {
  const nameField = $("#charName");
  const descField = $("#charDesc");
  const name = nameField?.value.trim();
  const desc = descField?.value.trim();

  if (!name || !desc) return toast("أدخل اسم الشخصية ووصفها");
  if (name.length > 60 || desc.length > 1500) return toast("تحقق من طول الاسم والوصف");

  const characters = getCharacters();
  if (characters.some(item => item.name?.toLowerCase() === name.toLowerCase())) {
    return toast("يوجد اسم مطابق؛ اختر اسماً آخر");
  }

  characters.push({ id: crypto.randomUUID?.() || String(Date.now()), name, desc, createdAt: new Date().toISOString() });
  if (writeStorage("ai_master_characters", characters)) {
    nameField.value = "";
    descField.value = "";
    renderCharacters();
    renderCharacterSelector();
    toast("تم حفظ الشخصية على هذا الجهاز");
  }
});

// ---------- Image generation ----------
$("#imageDemo")?.addEventListener("click", async () => {
  const promptField = $("#imagePrompt");
  const prompt = promptField?.value.trim();
  const button = $("#imageDemo");
  const message = $("#imageMsg");

  if (!prompt) return toast("اكتب وصف الصورة أولاً");

  const characters = getCharacters();
  const characterSelect = $("#imageCharacter");
  let selectedCharacter = null;
  if (characterSelect && characterSelect.value !== "") {
    const index = Number(characterSelect.value);
    if (Number.isInteger(index)) selectedCharacter = characters[index] || null;
  }

  let finalPrompt = prompt;
  if (selectedCharacter) {
    finalPrompt +=
      "\n\nCharacter reference:\n" +
      "Character name: " + selectedCharacter.name + "\n" +
      "Character description: " + selectedCharacter.desc + "\n" +
      "Keep the character's facial features, age, hairstyle and identity consistent with this description.";
  }

  if (finalPrompt.length > 2048) {
    return toast("الوصف مع الشخصية يتجاوز 2048 حرفاً؛ اختصره");
  }

  if (!button) return;
  button.disabled = true;
  button.textContent = "⏳ جارٍ التوليد...";
  if (message) message.textContent = "جارٍ إرسال الوصف إلى محرك الصور...";

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: finalPrompt })
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("استجابة الخادم غير صحيحة. تحقق من اتصال الموقع.");
    }

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "فشل توليد الصورة");
    if (!data.image || !data.image.startsWith("data:image/")) {
      throw new Error("لم تصل صورة صالحة من الخادم");
    }

    const item = {
      id: String(Date.now()),
      prompt,
      enhancedPrompt: finalPrompt !== prompt ? finalPrompt : null,
      characterName: selectedCharacter?.name || null,
      image: data.image,
      ratio: $("#ratio")?.value || "9:16 عمودي",
      date: new Date().toLocaleString("ar")
    };

    await saveImage(item);
    const image = $("#generatedImage") || document.createElement("img");
    image.id = "generatedImage";
    image.alt = "الصورة التي تم توليدها";
    image.className = "generated-image";
    image.src = data.image;
    if (!image.isConnected) (message || button).insertAdjacentElement("afterend", image);

    if (message) message.textContent = "تم توليد الصورة وحفظها في معرضك.";
    toast("تم حفظ الصورة بنجاح");
    renderRecent();
  } catch (error) {
    console.error(error);
    if (message) message.textContent = "حدث خطأ: " + (error.message || "تعذر توليد الصورة");
    toast("تعذر توليد الصورة");
  } finally {
    button.disabled = false;
    button.textContent = "✨ توليد الصورة الآن";
  }
});

// ---------- Video input preview and Flow ----------
$("#videoImage")?.addEventListener("change", event => {
  const file = event.target.files?.[0];
  const preview = $("#videoPreview");
  if (!file || !preview) return;
  if (!file.type.startsWith("image/")) {
    event.target.value = "";
    return toast("اختر ملف صورة صالحاً");
  }
  if (file.size > 10 * 1024 * 1024) {
    event.target.value = "";
    return toast("حجم الصورة يجب ألا يتجاوز 10 ميغابايت");
  }
  if (videoImageURL) URL.revokeObjectURL(videoImageURL);
  videoImageURL = URL.createObjectURL(file);
  preview.src = videoImageURL;
  preview.classList.remove("hidden");
  toast("تم اختيار صورة الفيديو");
});

$("#videoDemo")?.addEventListener("click", () => {
  const prompt = $("#videoPrompt")?.value.trim();
  if (!prompt) return toast("اكتب وصف الفيديو أولاً");

  const items = readStorage("ai_master_prompts", []);
  items.unshift({
    id: String(Date.now()),
    type: "وصف فيديو",
    prompt,
    engine: $("#videoEngine")?.value || "auto",
    duration: $("#videoDuration")?.value || "8",
    imageName: $("#videoImage")?.files?.[0]?.name || null,
    date: new Date().toLocaleString("ar")
  });

  if (!writeStorage("ai_master_prompts", items)) return;
  const message = $("#videoMsg");
  if (message) message.textContent = "تم حفظ وصف الفيديو. افتح Google Flow لإنشاء الفيديو ثم استورده هنا.";
  toast("تم حفظ إعدادات الفيديو");
  renderGallery();
});

function setupFlowStudio() {
  const button = $("#videoDemo");
  if (!button || $("#flowStudioTools")) return;

  const panel = document.createElement("div");
  panel.id = "flowStudioTools";
  panel.className = "flow-tools";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "secondary";
  copyButton.textContent = "📋 نسخ وصف الفيديو";

  const flowButton = document.createElement("button");
  flowButton.type = "button";
  flowButton.className = "primary";
  flowButton.textContent = "🌐 فتح Google Flow";

  const heading = document.createElement("b");
  heading.textContent = "استيراد فيديو من الهاتف";

  const hint = document.createElement("small");
  hint.textContent = "اختر فيديو نزّلته من Google Flow لحفظه في معرض AI MASTER.";

  const upload = document.createElement("input");
  upload.type = "file";
  upload.accept = "video/*";
  upload.id = "videoImportFile";
  upload.setAttribute("aria-label", "اختيار فيديو من الهاتف");

  copyButton.addEventListener("click", async () => {
    const prompt = $("#videoPrompt")?.value.trim();
    if (!prompt) return toast("اكتب وصف الفيديو أولاً");
    const duration = $("#videoDuration")?.value || "8";
    const text = `${prompt}\n\nمدة الفيديو المستهدفة: ${duration} ثوانٍ.`;
    try {
      await navigator.clipboard.writeText(text);
      toast("تم نسخ وصف الفيديو");
    } catch {
      const temporary = document.createElement("textarea");
      temporary.value = text;
      document.body.appendChild(temporary);
      temporary.select();
      const copied = document.execCommand("copy");
      temporary.remove();
      toast(copied ? "تم نسخ الوصف" : "تعذر النسخ");
    }
  });

  flowButton.addEventListener("click", () => {
    const opened = window.open(FLOW_URL, "_blank", "noopener,noreferrer");
    if (!opened) toast("افتح Google Flow من المتصفح");
  });

  upload.addEventListener("change", async () => {
    const file = upload.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      upload.value = "";
      return toast("الملف المختار ليس فيديو");
    }
    if (file.size > 150 * 1024 * 1024) {
      upload.value = "";
      return toast("حجم الفيديو أكبر من 150 ميغابايت");
    }

    try {
      await saveVideoFile({
        id: "video-" + Date.now(),
        name: file.name,
        blob: file,
        prompt: $("#videoPrompt")?.value.trim() || "",
        date: new Date().toLocaleString("ar"),
        type: file.type
      });
      upload.value = "";
      if ($("#videoMsg")) $("#videoMsg").textContent = "تم حفظ الفيديو في معرضك.";
      toast("تم حفظ الفيديو بنجاح");
      await renderGallery();
      renderRecent();
    } catch (error) {
      console.error(error);
      toast("تعذر حفظ الفيديو؛ تحقق من مساحة الهاتف");
    }
  });

  panel.append(copyButton, flowButton, heading, hint, upload);
  button.insertAdjacentElement("afterend", panel);
}

// ---------- Image editing preview ----------
$("#editFile")?.addEventListener("change", event => {
  const file = event.target.files?.[0];
  const preview = $("#editPreview");
  if (!file || !preview) return;
  if (!file.type.startsWith("image/")) {
    event.target.value = "";
    return toast("اختر صورة صالحة");
  }
  if (file.size > 15 * 1024 * 1024) {
    event.target.value = "";
    return toast("حجم الصورة يجب ألا يتجاوز 15 ميغابايت");
  }
  if (editImageURL) URL.revokeObjectURL(editImageURL);
  editImageURL = URL.createObjectURL(file);
  preview.src = editImageURL;
  preview.classList.remove("hidden");
  toast("تمت معاينة الصورة");
});

// ---------- Media modal, download and share ----------
function closeMediaModal() {
  $("#mediaModal")?.remove();
  if (activeModalURL) {
    URL.revokeObjectURL(activeModalURL);
    activeModalURL = null;
  }
}

function openMediaModal(type, source, caption = "") {
  closeMediaModal();
  const modal = document.createElement("div");
  modal.id = "mediaModal";
  modal.className = "media-modal";

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "media-modal-backdrop";
  backdrop.setAttribute("aria-label", "إغلاق");
  backdrop.addEventListener("click", closeMediaModal);

  const dialog = document.createElement("div");
  dialog.className = "media-modal-dialog";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "media-modal-close";
  close.textContent = "✕";
  close.addEventListener("click", closeMediaModal);

  const media = document.createElement(type === "video" ? "video" : "img");
  media.className = "media-modal-media";
  if (type === "video") {
    media.controls = true;
    media.playsInline = true;
    activeModalURL = URL.createObjectURL(source);
    media.src = activeModalURL;
  } else {
    media.alt = caption || "صورة من المعرض";
    media.src = source;
  }

  const title = document.createElement("p");
  title.className = "media-modal-caption";
  title.textContent = caption;

  dialog.append(close, media, title);
  modal.append(backdrop, dialog);
  document.body.appendChild(modal);
}

function downloadMedia(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "AI-MASTER";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function shareMedia(blob, filename, title = "AI MASTER") {
  try {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
    } else {
      const url = URL.createObjectURL(blob);
      downloadMedia(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast("المشاركة غير متاحة؛ تم تجهيز التنزيل");
    }
  } catch (error) {
    if (error.name !== "AbortError") toast("تعذرت مشاركة الملف");
  }
}

// ---------- Gallery ----------
function setupGalleryTabs() {
  const gallery = $("#galleryItems");
  if (!gallery || $("#galleryTabs")) return;

  const tabs = document.createElement("div");
  tabs.id = "galleryTabs";
  tabs.className = "gallery-tabs";

  [["all", "الكل"], ["images", "الصور"], ["videos", "الفيديوهات"], ["prompts", "الأوصاف"]].forEach(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-tab";
    button.textContent = label;
    button.addEventListener("click", () => {
      currentGalleryFilter = value;
      $$(".gallery-tab", tabs).forEach(tab => tab.classList.toggle("active", tab === button));
      applyGalleryFilter();
    });
    tabs.appendChild(button);
  });

  gallery.parentElement.insertBefore(tabs, gallery);
  $$(".gallery-tab", tabs)[0]?.classList.add("active");
}

function applyGalleryFilter() {
  $$(".gallery-card[data-gallery-kind]").forEach(card => {
    card.hidden = currentGalleryFilter !== "all" && currentGalleryFilter !== card.dataset.galleryKind;
  });
}

function makeAction(label, action, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gallery-action" + (danger ? " danger" : "");
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function clearGalleryVideoURLs() {
  galleryVideoURLs.forEach(url => URL.revokeObjectURL(url));
  galleryVideoURLs.clear();
}

async function renderGallery() {
  const container = $("#galleryItems");
  if (!container) return;
  setupGalleryTabs();
  closeMediaModal();
  clearGalleryVideoURLs();
  container.innerHTML = "<p class='hint'>جارٍ تحميل المعرض...</p>";

  try {
    const [images, videos] = await Promise.all([getImages(), readVideoFiles()]);
    const prompts = readStorage("ai_master_prompts", []);
    images.sort((a, b) => Number(b.id) - Number(a.id));
    videos.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    container.replaceChildren();

    if (!images.length && !videos.length && !prompts.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "لا توجد أعمال محفوظة بعد.";
      container.appendChild(empty);
      return;
    }

    images.forEach(item => {
      const card = document.createElement("article");
      card.className = "gallery-card";
      card.dataset.galleryKind = "images";

      const image = document.createElement("img");
      image.src = item.image;
      image.alt = item.prompt || "صورة مولّدة";
      image.loading = "lazy";
      image.addEventListener("click", () => openMediaModal("image", item.image, item.prompt));

      const title = document.createElement("b");
      title.textContent = "🖼️ صورة مولّدة";
      const description = document.createElement("p");
      description.textContent = item.prompt || "";
      const date = document.createElement("small");
      date.textContent = item.date || "";

      const actions = document.createElement("div");
      actions.className = "gallery-actions";
      actions.append(
        makeAction("تكبير", () => openMediaModal("image", item.image, item.prompt)),
        makeAction("تنزيل", () => downloadMedia(item.image, `AI-MASTER-${item.id}.png`)),
        makeAction("مشاركة", async () => {
          try {
            const blob = await (await fetch(item.image)).blob();
            await shareMedia(blob, `AI-MASTER-${item.id}.png`);
          } catch { toast("تعذرت مشاركة الصورة"); }
        }),
        makeAction("حذف", async () => {
          if (!confirm("هل تريد حذف هذه الصورة نهائياً؟")) return;
          try {
            await deleteImage(item.id);
            toast("تم حذف الصورة");
            renderGallery();
            renderRecent();
          } catch { toast("تعذر حذف الصورة"); }
        }, true)
      );

      card.append(image, title, description, date, actions);
      if (item.characterName) {
        const character = document.createElement("small");
        character.textContent = "الشخصية: " + item.characterName;
        card.appendChild(character);
      }
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

    videos.forEach(item => {
      const card = document.createElement("article");
      card.className = "gallery-card";
      card.dataset.galleryKind = "videos";
      const player = document.createElement("video");
      player.controls = true;
      player.playsInline = true;
      player.preload = "metadata";
      player.className = "gallery-video";
      const url = URL.createObjectURL(item.blob);
      galleryVideoURLs.add(url);
      player.src = url;

      const name = document.createElement("b");
      name.textContent = item.name || "فيديو محفوظ";
      const date = document.createElement("small");
      date.textContent = item.date || "";
      const actions = document.createElement("div");
      actions.className = "gallery-actions";
      actions.append(
        makeAction("تكبير", () => openMediaModal("video", item.blob, item.name)),
        makeAction("تنزيل", () => downloadMedia(url, item.name || "AI-MASTER-video.mp4")),
        makeAction("مشاركة", () => shareMedia(item.blob, item.name || "AI-MASTER-video.mp4")),
        makeAction("حذف", async () => {
          if (!confirm("هل تريد حذف هذا الفيديو نهائياً؟")) return;
          try {
            await removeVideoFile(item.id);
            toast("تم حذف الفيديو");
            renderGallery();
            renderRecent();
          } catch { toast("تعذر حذف الفيديو"); }
        }, true)
      );
      card.append(player, name, date, actions);
      if (item.prompt) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "عرض وصف الفيديو";
        const text = document.createElement("p");
        text.textContent = item.prompt;
        details.append(summary, text);
        card.appendChild(details);
      }
      container.appendChild(card);
    });

    prompts.forEach(item => {
      const card = document.createElement("article");
      card.className = "gallery-card";
      card.dataset.galleryKind = "prompts";
      const title = document.createElement("b");
      title.textContent = item.type || "وصف محفوظ";
      const text = document.createElement("p");
      text.textContent = item.prompt || "";
      const date = document.createElement("small");
      date.textContent = item.date || "";
      card.append(title, text, date);
      container.appendChild(card);
    });

    applyGalleryFilter();
  } catch (error) {
    console.error(error);
    container.innerHTML = "";
    const message = document.createElement("p");
    message.className = "hint";
    message.textContent = "تعذر تحميل المعرض: " + (error.message || "خطأ غير معروف");
    container.appendChild(message);
  }
}

// ---------- Recent items on home ----------
async function renderRecent() {
  const container = $("#recent");
  if (!container) return;
  try {
    const images = await getImages();
    images.sort((a, b) => Number(b.id) - Number(a.id));
    container.replaceChildren();

    if (!images.length) {
      container.className = "empty";
      const icon = document.createElement("span");
      icon.textContent = "▧";
      const title = document.createElement("b");
      title.textContent = "معرضك ينتظرك";
      const hint = document.createElement("small");
      hint.textContent = "ستظهر هنا أحدث الصور التي تحفظها.";
      container.append(icon, title, hint);
      return;
    }

    container.className = "recent-grid";
    images.slice(0, 4).forEach(item => {
      const image = document.createElement("img");
      image.src = item.image;
      image.alt = item.prompt || "أحدث صورة";
      image.loading = "lazy";
      image.addEventListener("click", () => {
        showPage("gallery");
        openMediaModal("image", item.image, item.prompt);
      });
      container.appendChild(image);
    });
  } catch (error) {
    console.warn("تعذر عرض الأعمال الأخيرة", error);
  }
}

// ---------- Startup ----------
function startApp() {
  setupPromptEnhancer();
  setupFlowStudio();
  renderCharacters();
  renderCharacterSelector();
  renderRecent();

  // افتح الصفحة الافتراضية بأمان.
  if (!PAGE_IDS.some(id => $("#" + id)?.classList.contains("active"))) {
    $("#home")?.classList.add("active");
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(error => {
        console.warn("تعذر تسجيل Service Worker:", error);
      });
    }, { once: true });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp, { once: true });
} else {
  startApp();
}

window.addEventListener("beforeunload", () => {
  if (videoImageURL) URL.revokeObjectURL(videoImageURL);
  if (editImageURL) URL.revokeObjectURL(editImageURL);
  clearGalleryVideoURLs();
  if (activeModalURL) URL.revokeObjectURL(activeModalURL);
});

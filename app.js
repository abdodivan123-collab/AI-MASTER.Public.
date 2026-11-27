
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
// تحسين أوصاف الصور — نسخة آمنة
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
      toast("الوصف الأصلي يتجاوز حد 2048 حرفاً؛ اختصره أولاً");
      return;
    }

    const remaining = 2048 - current.length;

    if (remaining < 40) {
      toast("الوصف طويل جداً؛ سنحتفظ به دون إضافة تعليمات");
      return;
    }

    const addition = realismInstructions.slice(0, remaining);

    originalImagePrompt = current;
    field.value = current + addition;
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
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function saveImage(item) {
  const db = await openImageDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("images", "readwrite");
    transaction.objectStore("images").put(item);

    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getImages() {
  const db = await openImageDB();

  return new Promise((resolve, reject) => {
    const request = db.transaction("images", "readonly")
      .objectStore("images")
      .getAll();

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

  if (msg) {
    msg.textContent = "جارٍ توليد الصورة، يرجى الانتظار...";
  }

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt })
    });

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      throw new Error("استجابة الخادم غير صحيحة. أعد تحميل الصفحة وحاول مجدداً.");
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "فشل توليد الصورة. حاول مرة أخرى.");
    }

    if (!data.image || !data.image.startsWith("data:image/")) {
      throw new Error("لم تصل صورة صالحة من محرك التوليد.");
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

      if (msg) {
        msg.after(img);
      }
    }

    img.src = data.image;

    if (msg) {
      msg.textContent = "تم توليد الصورة وحفظها بنجاح!";
    }

    toast("تم حفظ الصورة في المعرض");

  } catch (error) {
    if (msg) {
      msg.textContent = "حدث خطأ: " + (error.message || "تعذر الاتصال بمحرك الصور");
    }

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

  if (videoImageURL) {
    URL.revokeObjectURL(videoImageURL);
  }

  videoImageURL = URL.createObjectURL(file);
  preview.src = videoImageURL;
  preview.classList.remove("hidden");

  if (msg) {
    msg.textContent = "تم اختيار الصورة بنجاح.";
  }

  toast("تم تحميل الصورة ومعاينتها");
});


// =====================================
// تجهيز إعدادات الفيديو
// =====================================

$("#videoDemo")?.addEventListener("click", () => {
  const prompt = $("#videoPrompt")?.value.trim();
  const engine = $("#videoEngine")?.value || "auto";
  const duration = $("#videoDuration")?.value || "5";
  const imageFile = $("#videoImage")?.files?.[0] || null;

  if (!prompt) {
    toast("اكتب وصف الفيديو أولاً");
    return;
  }

  if (imageFile && !imageFile.type.startsWith("image/")) {
    toast("الصورة المختارة غير صالحة");
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
      "تم حفظ إعدادات الفيديو. محرك التوليد الحقيقي لم يُربط بعد.";
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

  if (editImageURL) {
    URL.revokeObjectURL(editImageURL);
  }

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
// عرض الصور والأعمال في المعرض
// =====================================

async function renderGallery() {
  const container = $("#galleryItems");

  if (!container) return;

  container.innerHTML =
    "<p class='hint'>جارٍ تحميل المعرض...</p>";

  try {
    const images = await getImages();
    const prompts = get("ai_master_prompts");

    container.innerHTML = "";

    if (!images.length && !prompts.length) {
      container.innerHTML =
        "<p class='hint'>لا توجد أعمال محفوظة بعد.</p>";
      return;
    }

    images.sort((a, b) => Number(b.id) - Number(a.id));

    images.forEach(item => {
      const card = document.createElement("article");
      card.className = "gallery-card";

      const image = document.createElement("img");
      image.src = item.image;
      image.alt = item.prompt;

      image.style.cssText =
        "width:100%;border-radius:12px;display:block;margin-bottom:10px;";

      const title = document.createElement("b");
      title.textContent = "صورة مولّدة";

      const description = document.createElement("p");
      description.textContent = item.prompt;

      const date = document.createElement("small");
      date.textContent = item.date || "";

      card.append(image, title, description, date);

      if (item.enhancedPrompt) {
        const enhanced = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "عرض الوصف المحسّن";

        const enhancedText = document.createElement("p");
        enhancedText.textContent = item.enhancedPrompt;

        enhanced.append(summary, enhancedText);
        card.appendChild(enhanced);
      }

      container.appendChild(card);
    });

    prompts.forEach(item => {
      const card = document.createElement("article");
      card.className = "gallery-card";

      const title = document.createElement("b");
      title.textContent = item.type;

      const description = document.createElement("p");
      description.textContent = item.prompt;

      const date = document.createElement("small");
      date.textContent = item.date || "";

      card.append(title, description, date);
      container.appendChild(card);
    });

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
// تشغيل الوظائف عند فتح الموقع
// =====================================

renderCharacters();
renderGallery();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// =====================================
// AI MASTER — Google Flow Video Studio
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
      .objectStore("videos").getAll();

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


// إنشاء أدوات الفيديو في الصفحة

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

  const buttons = [copyButton, flowButton];

  buttons.forEach(b => {
    b.style.cssText =
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

      renderSavedVideos();

    } catch (error) {
      console.error(error);
      toast("تعذر حفظ الفيديو. تحقق من مساحة الهاتف.");
    }
  });
}


// عرض الفيديوهات داخل المعرض

async function renderSavedVideos() {
  const gallery = $("#galleryItems");

  if (!gallery) return;

  let section = $("#savedVideoSection");

  if (!section) {
    section = document.createElement("section");
    section.id = "savedVideoSection";
    section.style.cssText = "margin-top:20px;";
    gallery.appendChild(section);
  }

  section.innerHTML = "<h3>🎬 فيديوهاتي المحفوظة</h3>";

  try {
    const videos = await readVideoFiles();

    if (!videos.length) {
      section.innerHTML +=
        "<p class='hint'>لم تحفظ أي فيديو بعد.</p>";
      return;
    }

    videos.reverse().forEach(item => {
      const card = document.createElement("article");
      card.className = "gallery-card";
      card.style.cssText = "margin:12px 0;padding:12px;";

      const player = document.createElement("video");
      player.controls = true;
      player.playsInline = true;
      player.preload = "metadata";
      player.style.cssText =
        "width:100%;border-radius:12px;background:#000;";

      const url = URL.createObjectURL(item.blob);
      player.src = url;

      const name = document.createElement("p");
      name.textContent = item.name;

      const date = document.createElement("small");
      date.textContent = item.date || "";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "🗑 حذف الفيديو";
      remove.style.cssText =
        "display:block;margin-top:12px;padding:10px;background:#a22;color:white;border:0;border-radius:9px;";

      remove.addEventListener("click", async () => {
        if (!confirm("هل تريد حذف هذا الفيديو؟")) return;

        await removeVideoFile(item.id);
        URL.revokeObjectURL(url);
        card.remove();

        toast("تم حذف الفيديو");
      });

      card.append(player, name, date, remove);
      section.appendChild(card);
    });

  } catch (error) {
    section.innerHTML +=
      "<p>تعذر تحميل الفيديوهات.</p>";
  }
}


// تفعيل الأدوات وتحديث المعرض

setupFlowStudio();

const oldRenderGallery = renderGallery;

renderGallery = async function () {
  await oldRenderGallery();
  await renderSavedVideos();
};

renderGallery();

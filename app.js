
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
// نظام تحسين أوصاف الصور
// =====================================

let originalImagePrompt = null;
let promptIsEnhanced = false;

const realismInstructions = `

PHOTOREALISTIC IMAGE REQUIREMENTS:
Create a realistic professional photograph.
Follow the user's original description as accurately as possible.
Preserve the exact requested subject, age, appearance,
hair color, eye color, clothing, clothing color, pose,
facial expression, objects and background.
Do not change or replace any specifically requested detail.

REALISTIC DETAILS:
Natural human anatomy and body proportions.
Detailed realistic facial features.
Natural skin texture with visible fine details.
Realistic individual hair strands.
Accurate clothing materials, folds and stitching.
Natural hands and correctly shaped fingers.
Realistic lighting, shadows, reflections and perspective.
Natural photographic colors and realistic depth of field.

AVOID:
Cartoon, anime, illustration, CGI, plastic skin,
artificial beauty filters, distorted anatomy,
extra fingers, missing fingers, blurry faces,
unrequested objects and unwanted changes.

STYLE:
High-quality professional DSLR photography.
Extremely photorealistic, sharp focus,
natural lighting and fine image details.
`;

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

    const enhanced = current + realismInstructions;

    if (enhanced.length > 2048) {
      toast("الوصف طويل جداً للتحسين. اختصره قليلاً.");
      return;
    }

    originalImagePrompt = current;
    field.value = enhanced;
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
// توليد الصور عبر Workers AI
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
      throw new Error("استجابة الخادم غير صحيحة");
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "فشل توليد الصورة");
    }

    if (!data.image || !data.image.startsWith("data:image/")) {
      throw new Error("لم تصل صورة صالحة من المحرك");
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
      msg.textContent = "حدث خطأ: " + error.message;
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

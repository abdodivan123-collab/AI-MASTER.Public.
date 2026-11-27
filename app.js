
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

// قاعدة بيانات لحفظ الصور على الجهاز
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

// توليد الصور عبر Workers AI
$("#imageDemo").addEventListener("click", async () => {
  const prompt = $("#imagePrompt").value.trim();

  if (!prompt) {
    toast("اكتب وصف الصورة أولاً");
    return;
  }

  const btn = $("#imageDemo");
  const msg = $("#imageMsg");

  btn.disabled = true;
  msg.textContent = "جارٍ توليد الصورة، انتظر قليلاً...";

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
      prompt,
      image: data.image,
      ratio: $("#ratio").value,
      date: new Date().toLocaleString("ar")
    };

    // حفظ الصورة نفسها في قاعدة البيانات
    await saveImage(imageItem);

    let img = $("#generatedImage");

    if (!img) {
      img = document.createElement("img");
      img.id = "generatedImage";
      img.style.cssText =
        "display:block;width:100%;max-width:600px;margin:15px auto;border-radius:12px;";
      msg.after(img);
    }

    img.src = data.image;
    msg.textContent = "تم توليد الصورة وحفظها بنجاح!";
    toast("تم حفظ الصورة في المعرض");

  } catch (error) {
    msg.textContent = "حدث خطأ: " + error.message;
    toast("تعذر توليد الصورة");
  } finally {
    btn.disabled = false;
  }
});

// إعدادات توليد الفيديو
$("#videoDemo").addEventListener("click", () => {
  const prompt = $("#videoPrompt").value.trim();

  if (!prompt) {
    toast("اكتب وصف الفيديو أولاً");
    return;
  }

  const items = get("ai_master_prompts");

  items.unshift({
    type: "فيديو",
    prompt,
    date: new Date().toLocaleString("ar")
  });

  set("ai_master_prompts", items);

  $("#videoMsg").textContent =
    "تم حفظ وصف الفيديو محلياً. محرك الفيديو غير مربوط بعد.";

  toast("تم حفظ وصف الفيديو");
});

// معاينة الصورة المراد تعديلها
$("#editFile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  $("#editPreview").src = url;
  $("#editPreview").classList.remove("hidden");
});

$("#videoImage").addEventListener("change", e => {
  if (e.target.files[0]) {
    toast("تم اختيار الصورة: " + e.target.files[0].name);
  }
});

// حفظ الشخصيات
$("#saveCharacter").addEventListener("click", () => {
  const name = $("#charName").value.trim();
  const desc = $("#charDesc").value.trim();

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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function renderCharacters() {
  const characters = get("ai_master_characters");
  const container = $("#characterList");

  container.innerHTML = characters.length
    ? characters.map(item =>
        `<article class="character">
          <b>${escapeHtml(item.name)}</b>
          <p>${escapeHtml(item.desc)}</p>
        </article>`
      ).join("")
    : "<p class='hint'>لم تحفظ أي شخصية بعد.</p>";
}

// عرض الصور والأعمال في المعرض
async function renderGallery() {
  const container = $("#galleryItems");

  container.innerHTML = "<p class='hint'>جارٍ تحميل المعرض...</p>";

  try {
    const images = await getImages();
    const prompts = get("ai_master_prompts");

    container.innerHTML = "";

    if (!images.length && !prompts.length) {
      container.innerHTML = "<p class='hint'>لا توجد أعمال محفوظة بعد.</p>";
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

$("#themeInfo").addEventListener("click", () =>
  toast("AI MASTER — منصتك الخاصة")
);

renderCharacters();
renderGallery();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

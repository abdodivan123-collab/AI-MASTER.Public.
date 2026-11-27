
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

const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// توليد الصور عبر Workers AI
$("#imageDemo").addEventListener("click", async () => {
  const p = $("#imagePrompt").value.trim();

  if (!p) return toast("اكتب وصف الصورة أولاً");

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
      body: JSON.stringify({ prompt: p })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "فشل توليد الصورة");
    }

    if (!data.image) {
      throw new Error("لم تصل الصورة من المحرك");
    }

    let img = $("#generatedImage");

    if (!img) {
      img = document.createElement("img");
      img.id = "generatedImage";
      img.style.cssText =
        "display:block;width:100%;max-width:600px;margin:15px auto;border-radius:12px;";
      msg.after(img);
    }

    img.src = data.image;
    msg.textContent = "تم توليد الصورة بنجاح!";

    let q = get("ai_master_prompts");
    q.unshift({
      type: "صورة",
      prompt: p,
      ratio: $("#ratio").value,
      date: new Date().toLocaleString("ar")
    });

    set("ai_master_prompts", q);
    toast("تم توليد الصورة بنجاح");

  } catch (error) {
    msg.textContent = "حدث خطأ: " + error.message;
    toast("تعذر توليد الصورة");
  } finally {
    btn.disabled = false;
  }
});

// إعدادات توليد الفيديو
$("#videoDemo").addEventListener("click", () => {
  let p = $("#videoPrompt").value.trim();
  if (!p) return toast("اكتب وصف الفيديو أولاً");

  let q = get("ai_master_prompts");
  q.unshift({
    type: "فيديو",
    prompt: p,
    date: new Date().toLocaleString("ar")
  });

  set("ai_master_prompts", q);
  $("#videoMsg").textContent =
    "تم حفظ إعدادات الفيديو محلياً. محرك الفيديو غير مربوط بعد.";
  toast("حُفظت إعدادات الفيديو");
});

// معاينة الصورة المراد تعديلها
$("#editFile").addEventListener("change", e => {
  let f = e.target.files[0];
  if (!f) return;

  let u = URL.createObjectURL(f);
  $("#editPreview").src = u;
  $("#editPreview").classList.remove("hidden");
});

$("#videoImage").addEventListener("change", e => {
  if (e.target.files[0]) {
    toast("تم اختيار الصورة: " + e.target.files[0].name);
  }
});

// حفظ الشخصيات
$("#saveCharacter").addEventListener("click", () => {
  let n = $("#charName").value.trim();
  let d = $("#charDesc").value.trim();

  if (!n || !d) return toast("أدخل اسم الشخصية ووصفها");

  let a = get("ai_master_characters");
  a.push({ name: n, desc: d });
  set("ai_master_characters", a);

  $("#charName").value = "";
  $("#charDesc").value = "";

  renderCharacters();
  toast("تم حفظ الشخصية على هذا الجهاز");
});

function renderCharacters() {
  let a = get("ai_master_characters");

  $("#characterList").innerHTML = a.length
    ? a.map(x =>
        `<article class="character"><b>${escapeHtml(x.name)}</b><p>${escapeHtml(x.desc)}</p></article>`
      ).join("")
    : "<p class='hint'>لم تحفظ أي شخصية بعد.</p>";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

// معرض الأعمال
function renderGallery() {
  let a = get("ai_master_prompts");

  $("#galleryItems").innerHTML = a.length
    ? a.map(x =>
        `<article class="gallery-card"><b>${escapeHtml(x.type)}</b><p>${escapeHtml(x.prompt)}</p><small>${escapeHtml(x.date || "")}</small></article>`
      ).join("")
    : "<p class='hint'>لا توجد أعمال محفوظة بعد.</p>";
}

$("#themeInfo").addEventListener("click", () =>
  toast("AI MASTER — نسخة تأسيسية خاصة بك")
);

renderCharacters();
renderGallery();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("./sw.js").catch(() => {})
  );
}

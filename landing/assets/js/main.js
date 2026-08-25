/* ============================================================
   ZE-POS Landing — interactions
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Nav: scroll + mobile ---------- */
  const nav = document.getElementById("nav");
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");

  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle("scrolled", window.scrollY > 8);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (toggle && links) {
    toggle.addEventListener("click", () => links.classList.toggle("open"));
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => links.classList.remove("open"))
    );
  }

  /* ---------- Reveal on scroll ---------- */
  const reveals = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const delay = Number(e.target.dataset.delay || 0);
          setTimeout(() => e.target.classList.add("in"), delay);
          io.unobserve(e.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* ---------- Stat counters ---------- */
  const counters = document.querySelectorAll("[data-count]");
  const animateCount = (el) => {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix || (target === 99 ? "%" : "+");
    const duration = 1400;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString() + suffix;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (counters.length && "IntersectionObserver" in window) {
    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          animateCount(e.target);
          cio.unobserve(e.target);
        });
      },
      { threshold: 0.4 }
    );
    counters.forEach((el) => cio.observe(el));
  }

  /* ---------- Tour tabs ---------- */
  const tabs = document.querySelectorAll(".tour-tab");
  const panels = document.querySelectorAll(".tour-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panels.forEach((p) => p.classList.toggle("active", p.dataset.panel === id));
      // re-trigger bar grow if reports
      if (id === "reports") {
        document.querySelectorAll(".dr-chart .bar").forEach((b) => {
          b.style.animation = "none";
          // force reflow
          void b.offsetWidth;
          b.style.animation = "";
        });
      }
      // re-trigger bar grow if leaderboards
      if (id === "leaderboards") {
        document.querySelectorAll(".demo-payroll .dp-row").forEach((r, i) => {
          r.style.animation = "none";
          void r.offsetWidth;
          r.style.animation = "";
        });
      }
    });
  });

  /* ---------- Interactive POS demo ---------- */
  const MENU = [
    { id: 1, name: "Cheeseburger", price: 120, emoji: "🍔", cat: "mains" },
    { id: 2, name: "Pepperoni", price: 180, emoji: "🍕", cat: "mains" },
    { id: 3, name: "Fried Chicken", price: 150, emoji: "🍗", cat: "mains" },
    { id: 4, name: "Iced Tea", price: 40, emoji: "🥤", cat: "drinks" },
    { id: 5, name: "Americano", price: 60, emoji: "☕", cat: "drinks" },
    { id: 6, name: "Fries", price: 50, emoji: "🍟", cat: "sides" },
    { id: 7, name: "Onion Rings", price: 55, emoji: "🧅", cat: "sides" },
    { id: 8, name: "Cake Slice", price: 90, emoji: "🍰", cat: "sides" },
  ];

  const grid = document.getElementById("demoGrid");
  const linesEl = document.getElementById("demoLines");
  const totalEl = document.getElementById("demoTotal");
  const payBtn = document.getElementById("demoPay");
  const orderNoEl = document.getElementById("demoOrderNo");
  const typeEl = document.getElementById("demoType");

  if (grid && linesEl) {
    let cart = [];
    let orderNo = 1042;
    let orderType = "Dine-In";
    let cat = "all";

    const peso = (n) => "₱" + n.toLocaleString();

    const renderGrid = () => {
      const items = MENU.filter((m) => cat === "all" || m.cat === cat);
      grid.innerHTML = items
        .map(
          (m) => `
        <button class="demo-item" data-id="${m.id}">
          <span>${m.emoji}</span>
          <b>${m.name}</b>
          <i>${peso(m.price)}</i>
        </button>`
        )
        .join("");
    };

    const renderCart = () => {
      if (!cart.length) {
        linesEl.innerHTML = `<div class="demo-empty">Tap an item to add it</div>`;
      } else {
        linesEl.innerHTML = cart
          .map(
            (l, i) => `
          <div class="demo-line">
            <span>${l.emoji} ${l.name} ×${l.qty}</span>
            <span>
              <b>${peso(l.price * l.qty)}</b>
              <button data-rm="${i}" aria-label="Remove">×</button>
            </span>
          </div>`
          )
          .join("");
      }
      const sum = cart.reduce((s, l) => s + l.price * l.qty, 0);
      totalEl.textContent = peso(sum);
      payBtn.disabled = !cart.length;
    };

    const addItem = (id) => {
      const item = MENU.find((m) => m.id === id);
      if (!item) return;
      const existing = cart.find((l) => l.id === id);
      if (existing) existing.qty += 1;
      else cart.push({ ...item, qty: 1 });
      renderCart();
    };

    grid.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-id]");
      if (btn) addItem(Number(btn.dataset.id));
    });

    linesEl.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-rm]");
      if (!rm) return;
      cart.splice(Number(rm.dataset.rm), 1);
      renderCart();
    });

    document.querySelectorAll(".demo-tabs button").forEach((b) => {
      b.addEventListener("click", () => {
        cat = b.dataset.cat;
        document.querySelectorAll(".demo-tabs button").forEach((x) =>
          x.classList.toggle("active", x === b)
        );
        renderGrid();
      });
    });

    document.querySelectorAll(".demo-types button").forEach((b) => {
      b.addEventListener("click", () => {
        orderType = b.dataset.type;
        typeEl.textContent = orderType;
        document.querySelectorAll(".demo-types button").forEach((x) =>
          x.classList.toggle("active", x === b)
        );
      });
    });

    payBtn.addEventListener("click", () => {
      if (!cart.length) return;
      const wrap = document.getElementById("demoPos");
      const toast = document.createElement("div");
      toast.className = "demo-toast";
      toast.textContent = `Order ${orderNoEl.textContent} completed · ${totalEl.textContent}`;
      wrap.style.position = "relative";
      wrap.appendChild(toast);
      setTimeout(() => toast.remove(), 2200);
      cart = [];
      orderNo += 1;
      orderNoEl.textContent = "#" + orderNo;
      renderCart();
    });

    renderGrid();
    renderCart();
  }

  /* ---------- Store switcher demo ---------- */
  const storeData = {
    Makati: { rev: "₱18,400", orders: "142", staff: "5", items: "86" },
    Cebu: { rev: "₱11,250", orders: "97", staff: "3", items: "64" },
    Davao: { rev: "₱7,880", orders: "61", staff: "2", items: "52" },
  };
  document.querySelectorAll(".ds-switch span").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".ds-switch span").forEach((c) =>
        c.classList.toggle("active", c === chip)
      );
      const name = chip.textContent.replace("🏪 ", "").trim();
      const d = storeData[name];
      if (!d) return;
      const stats = document.querySelectorAll(".ds-stat");
      if (stats.length >= 4) {
        stats[0].querySelector("b").textContent = d.rev;
        stats[0].querySelector("span").textContent = "Today · " + name;
        stats[1].querySelector("b").textContent = d.orders;
        stats[2].querySelector("b").textContent = d.staff;
        stats[3].querySelector("b").textContent = d.items;
      }
    });
  });

  /* ---------- Menu demo size chips ---------- */
  document.querySelectorAll(".dmi-sizes").forEach((row) => {
    row.addEventListener("click", (e) => {
      const chip = e.target.closest("span");
      if (!chip) return;
      row.querySelectorAll("span").forEach((s) => s.classList.toggle("active", s === chip));
    });
  });
  document.querySelectorAll(".demo-menu-cats").forEach((row) => {
    row.addEventListener("click", (e) => {
      const chip = e.target.closest("span");
      if (!chip) return;
      row.querySelectorAll("span").forEach((s) => s.classList.toggle("active", s === chip));
    });
  });

  /* ---------- Contact form ---------- */
  const form = document.getElementById("contactForm");
  const success = document.getElementById("formSuccess");
  const resetBtn = document.getElementById("formReset");

  const CONTACT_EMAIL = "ze.pos.official@gmail.com";
  const TOPIC_LABELS = {
    trial: "Start a free trial",
    demo: "Book a live demo",
    pricing: "Pricing & plans",
    support: "Technical support",
    partnership: "Partnership / reseller",
    other: "Something else",
  };

  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const setError = (el, msg) => {
    const group = el.closest(".form-group");
    if (!group) return;
    group.classList.add("error");
    let err = group.querySelector(".err");
    if (!err) {
      err = document.createElement("span");
      err.className = "err";
      group.appendChild(err);
    }
    err.textContent = msg;
  };
  const clearError = (el) => {
    const group = el.closest(".form-group");
    if (group) group.classList.remove("error");
  };

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let ok = true;
      const name = form.name;
      const email = form.email;
      const topic = form.topic;
      const message = form.message;

      [name, email, topic, message].forEach(clearError);

      if (!name.value.trim()) {
        setError(name, "Please tell us your name.");
        ok = false;
      }
      if (!email.value.trim() || !emailOk(email.value)) {
        setError(email, "Enter a valid email so we can reply.");
        ok = false;
      }
      if (!topic.value) {
        setError(topic, "Pick a topic so we can route your message.");
        ok = false;
      }
      if (!message.value.trim() || message.value.trim().length < 8) {
        setError(message, "A few more words help us help you.");
        ok = false;
      }
      if (!ok) return;

      // No backend on this static site — hand off to the visitor's own
      // email client via mailto:, pre-addressed and pre-filled, so the
      // inquiry actually reaches CONTACT_EMAIL instead of vanishing.
      const topicLabel = TOPIC_LABELS[topic.value] || topic.value;
      const business = form.business.value.trim();
      const phone = form.phone.value.trim();
      const subject = `ZE-POS inquiry: ${topicLabel}`;
      const bodyLines = [
        `Name: ${name.value.trim()}`,
        `Email: ${email.value.trim()}`,
        business ? `Business: ${business}` : null,
        phone ? `Phone: ${phone}` : null,
        `Topic: ${topicLabel}`,
        "",
        message.value.trim(),
      ].filter((l) => l !== null);
      const mailtoUrl =
        `mailto:${CONTACT_EMAIL}` +
        `?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(bodyLines.join("\n"))}`;
      window.location.href = mailtoUrl;

      const reply = document.getElementById("replyEmail");
      if (reply) reply.textContent = email.value.trim();
      form.style.visibility = "hidden";
      if (success) success.classList.remove("hidden");
    });

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        form.reset();
        form.style.visibility = "";
        if (success) success.classList.add("hidden");
      });
    }
  }

  /* ---------- Inside the App sidebar ---------- */
  const sidebarLinks = document.querySelectorAll("#appSidebar .sidebar-link-demo");
  const featurePanels = document.querySelectorAll("#appContent .feature-panel");

  if (sidebarLinks.length && featurePanels.length) {
    sidebarLinks.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const feature = link.dataset.feature;
        if (!feature) return;

        sidebarLinks.forEach((l) => l.classList.toggle("active", l === link));
        featurePanels.forEach((p) => p.classList.toggle("active", p.dataset.panel === feature));
      });
    });
  }
})();

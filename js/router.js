// Simple hash-based router
SG.router = {
  current: "dashboard",
  routes: {},

  register(name, render, meta = {}) {
    this.routes[name] = { render, meta };
  },

  go(name) {
    if (!this.routes[name]) name = "dashboard";
    this.current = name;
    const { render, meta } = this.routes[name];
    document.getElementById("page-title").textContent = meta.title || name;
    document.getElementById("page-sub").textContent  = meta.sub   || "";

    // Highlight nav
    document.querySelectorAll(".nav-item").forEach(el => {
      el.classList.toggle("active", el.dataset.route === name);
    });

    const view = document.getElementById("view");
    view.innerHTML = "";
    render(view);
    view.scrollTop = 0;
    if (history.replaceState) history.replaceState(null, "", "#" + name);
  }
};

// el(): tiny DOM helper
SG.el = function(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const k in attrs) {
    if (k === "class")        node.className = attrs[k];
    else if (k === "html")    node.innerHTML = attrs[k];
    else if (k.startsWith("on") && typeof attrs[k] === "function")
                              node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    else if (attrs[k] === true)  node.setAttribute(k, "");
    else if (attrs[k] != null)   node.setAttribute(k, attrs[k]);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
};

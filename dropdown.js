/* Our own dropdown, drawn like the segmented switch it replaces: the closed
   control is a track holding the chosen value as the active segment plus a
   caret cell; open, the options stack as the same cells. The native <select>
   stays in the page as the source of truth (display.js reads and sets it),
   hidden; every change goes through it, so nothing else needs to know.

   Enhances every `select[data-dropdown]`. Call window.Dropdown.refresh() after
   setting a select's value or its options' hidden/disabled from script. */
(() => {
  const widgets = [];
  let openWidget = null;

  function build(select) {
    const root = document.createElement("div");
    root.className = "dropdown";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "dropdown-toggle";
    toggle.setAttribute("aria-haspopup", "listbox");
    toggle.setAttribute("aria-expanded", "false");
    if (select.getAttribute("aria-label")) toggle.setAttribute("aria-label", select.getAttribute("aria-label"));
    const value = document.createElement("span");
    value.className = "dropdown-value";
    const caret = document.createElement("span");
    caret.className = "dropdown-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.innerHTML = '<svg viewBox="0 0 10 6" width="10" height="6"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    toggle.append(value, caret);
    const menu = document.createElement("div");
    menu.className = "dropdown-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    root.append(toggle, menu);
    select.classList.add("dropdown-native");
    select.tabIndex = -1;
    select.insertAdjacentElement("afterend", root);

    const widget = { select, root, toggle, value, menu };

    function render() {
      const current = select.selectedOptions[0];
      value.textContent = current ? current.textContent : "";
      toggle.disabled = select.disabled;
      root.classList.toggle("is-disabled", select.disabled);
      menu.innerHTML = "";
      [...select.options].forEach((option) => {
        if (option.hidden) return;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "dropdown-item";
        item.setAttribute("role", "option");
        item.dataset.value = option.value;
        item.textContent = option.textContent;
        item.disabled = option.disabled;
        const on = option === current;
        item.classList.toggle("is-active", on);
        item.setAttribute("aria-selected", on ? "true" : "false");
        menu.appendChild(item);
      });
    }

    function open() {
      if (toggle.disabled) return;
      if (openWidget && openWidget !== widget) close(openWidget);
      render();
      menu.hidden = false;
      root.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      openWidget = widget;
      (menu.querySelector(".is-active") || menu.querySelector(".dropdown-item:not(:disabled)"))?.focus();
    }

    toggle.addEventListener("click", () => (menu.hidden ? open() : close(widget)));
    menu.addEventListener("click", (event) => {
      const item = event.target.closest(".dropdown-item");
      if (!item || item.disabled) return;
      close(widget);
      if (item.dataset.value !== select.value) {
        select.value = item.dataset.value;
        select.dispatchEvent(new Event("change"));
      }
      render();
    });
    root.addEventListener("keydown", (event) => {
      const items = [...menu.querySelectorAll(".dropdown-item:not(:disabled)")];
      const index = items.indexOf(document.activeElement);
      if (event.key === "Escape" && !menu.hidden) {
        event.preventDefault();
        close(widget);
        toggle.focus();
      } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !menu.hidden && items.length) {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        items[(index + step + items.length) % items.length].focus();
      } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && menu.hidden) {
        event.preventDefault();
        open();
      }
    });
    select.addEventListener("change", render);
    widget.render = render;
    render();
    widgets.push(widget);
  }

  function close(widget) {
    widget.menu.hidden = true;
    widget.root.classList.remove("is-open");
    widget.toggle.setAttribute("aria-expanded", "false");
    if (openWidget === widget) openWidget = null;
  }

  document.addEventListener("pointerdown", (event) => {
    if (openWidget && !openWidget.root.contains(event.target)) close(openWidget);
  });
  // the menu must not stay open when focus leaves it (e.g. Tab)
  document.addEventListener("focusin", (event) => {
    if (openWidget && !openWidget.root.contains(event.target)) close(openWidget);
  });

  document.querySelectorAll("select[data-dropdown]").forEach(build);

  window.Dropdown = {
    refresh() {
      widgets.forEach((w) => w.render());
    }
  };
})();

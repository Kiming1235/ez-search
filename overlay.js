const selectionBox = document.getElementById("selectionBox");
const loadingBadge = document.getElementById("loadingBadge");
const subtitleBubble = document.getElementById("subtitleBubble");

let dragStart = null;
let dragCurrent = null;
let selectionLocked = false;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function renderSelection(rect) {
  selectionBox.hidden = false;
  selectionBox.style.left = `${rect.x}px`;
  selectionBox.style.top = `${rect.y}px`;
  selectionBox.style.width = `${rect.width}px`;
  selectionBox.style.height = `${rect.height}px`;
}

function positionNearSelection(element, rect, preferredWidth = 420) {
  const margin = 16;
  const topGap = 12;
  const bubbleWidth = Math.min(preferredWidth, window.innerWidth - margin * 2);
  const left = clamp(rect.x, margin, window.innerWidth - bubbleWidth - margin);
  const showAbove = rect.y > 120;
  const top = showAbove
    ? Math.max(rect.y - topGap - 84, margin)
    : Math.min(rect.y + rect.height + topGap, window.innerHeight - 120);

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.transform = "none";
}

async function completeSelection() {
  if (!dragStart || !dragCurrent || selectionLocked) {
    return;
  }

  const rect = normalizeRect(dragStart, dragCurrent);
  if (rect.width < 12 || rect.height < 12) {
    return;
  }

  selectionLocked = true;
  loadingBadge.hidden = false;
  positionNearSelection(loadingBadge, rect, 200);

  try {
    const result = await window.screenExplainOverlay.submitSelection(rect);
    subtitleBubble.textContent = result.answer;
    positionNearSelection(subtitleBubble, rect);
    subtitleBubble.hidden = false;
    loadingBadge.hidden = true;
  } catch (error) {
    subtitleBubble.textContent = error.message || String(error);
    positionNearSelection(subtitleBubble, rect);
    subtitleBubble.hidden = false;
    loadingBadge.hidden = true;
  }
}

window.addEventListener("mousedown", (event) => {
  if (selectionLocked) {
    return;
  }

  dragStart = { x: event.clientX, y: event.clientY };
  dragCurrent = dragStart;
  renderSelection({ x: dragStart.x, y: dragStart.y, width: 0, height: 0 });
});

window.addEventListener("mousemove", (event) => {
  if (!dragStart || selectionLocked) {
    return;
  }

  dragCurrent = { x: event.clientX, y: event.clientY };
  renderSelection(normalizeRect(dragStart, dragCurrent));
});

window.addEventListener("mouseup", () => {
  completeSelection();
});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.screenExplainOverlay.cancel();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.screenExplainOverlay.cancel();
  }
});

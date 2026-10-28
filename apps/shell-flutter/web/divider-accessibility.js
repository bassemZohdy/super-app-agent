// Flutter web puts the label on the semantics container and a separate range
// input inside it. Link the two until the engine names the input itself.
const dividerSelector = 'flt-semantics[flt-semantics-identifier^="cityside.workspace-divider."]';
const assigned = new WeakMap();

function labelDivider(element) {
  if (!element || !element.id || !element.getAttribute('aria-label')?.trim()) return;
  const slider = element.querySelector(':scope > input[type="range"][role="slider"]');
  if (!slider) return;
  const existing = slider.getAttribute('aria-labelledby')?.trim();
  const previous = assigned.get(slider);
  if (slider.getAttribute('aria-label')?.trim()) {
    if (previous && existing === previous) slider.removeAttribute('aria-labelledby');
    assigned.delete(slider);
    return;
  }
  if (existing && existing !== previous) return;
  if (existing !== element.id) {
    assigned.set(slider, element.id);
    slider.setAttribute('aria-labelledby', element.id);
  }
}

const observer = new MutationObserver(records => {
  for (const record of records) {
    const target = record.target instanceof Element ? record.target : null;
    labelDivider(target?.closest(dividerSelector));
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(dividerSelector)) labelDivider(node);
      node.querySelectorAll(dividerSelector).forEach(labelDivider);
    }
  }
});
observer.observe(document.body, { subtree: true, childList: true, attributes: true,
  attributeFilter: ['id', 'aria-label', 'aria-labelledby', 'flt-semantics-identifier'] });
document.querySelectorAll(dividerSelector).forEach(labelDivider);

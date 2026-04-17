## 2026-04-17 - Add aria-labels to inputs
**Learning:** Relying solely on `placeholder` attributes for form inputs without visible `<label>` tags is an accessibility anti-pattern. Screen readers may not read them reliably, and they disappear when the user starts typing.
**Action:** Always include `aria-label` attributes on any input or textarea that lacks an associated visible `<label>` element.

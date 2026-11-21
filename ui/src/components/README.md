# Public component API

Import supported UI components from this directory's `index.ts` barrel.

The public surface includes beneficiary registration, emergency deployment,
merchant mapping, conditional transfer cards, dashboards, confirmation dialogs,
error presentation, form fields, and the notification provider/hook.

Accessibility implementation hooks and other internal helpers are deliberately
not re-exported. Internal UI code should import those helpers directly from
their owning module so they do not become accidental package API.

When adding a component, decide explicitly whether it is part of the supported
public API and update `index.ts` and `componentExports.test.ts` together.

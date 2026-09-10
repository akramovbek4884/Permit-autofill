# Permit Autofill

Chrome side-panel extension that assists with filling OS/OW commercial trucking permit applications. It is designed to prefill carrier, power-unit, trailer, load, dimension, and axle data while the user is on an approved DOT permit portal.

## Safety boundary

- The extension only runs on the approved permit-portal domains listed in `manifest.json`.
- It does **not** automate login, CAPTCHA/MFA, payment, or final permit submission.
- Verify every field, route, restriction, fee, and permit type before submitting an application.
- Saved draft data is stored locally in the active Chrome profile. Use **Clear saved draft** on a shared computer.

## Supported portal adapters

Dedicated routing logic currently exists for:

- Alabama AL-ePASS (Bentley)
- Texas TxPROS
- Kentucky KAPS
- GotPermits-family portals use the conservative generic adapter

Other approved portals use the generic adapter until a portal-specific adapter is added and tested with an authorized account.

## Install locally

1. Clone this repository.
2. In Chrome, open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose the cloned `Permit-autofill` folder.
4. Open a supported permit portal, then click the extension icon to open its side panel.
5. Enter or select the equipment and load details, click **Autofill Form**, review the resulting page, and submit manually.

## Development

There is no build step. Validate source files before loading the extension:

```bash
jq empty manifest.json
node --check background.js
node --check content.js
node --check popup.js
```

Do not add customer credentials, passwords, payment details, or permit documents to this repository.

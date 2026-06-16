# Privacy Policy

**Last updated: June 2026**

Inkplainer is built on a simple principle: your content is yours. It is never collected, stored on a server, or sent anywhere. This document explains exactly what the app does and doesn't do with your data.

---

## Summary

| | |
|--|--|
| 🖥️ **Project content stays local** | Your images and videos are never uploaded to any server |
| 🚫 **No accounts or analytics** | No sign-up required. No analytics. No session recording |
| 🆓 **Free to use** | No ads, no subscriptions, no sale of personal data |

---

## 1. What Inkplainer does with your content

> ✓ Your images, text, and exported videos never leave your device. All animation processing and video recording happens entirely in your browser using local computation.

When you upload an image or create a text layer, that content is stored locally in your browser's storage (IndexedDB) so your project is automatically saved between sessions. It is never transmitted to any server — because Inkplainer has no server that receives your content.

When you export a video, the recording and encoding happens on your device using your browser's built-in capabilities. The resulting file is downloaded directly to your computer. No one receives, processes, or stores that file.

---

## 2. What data we collect

None. Inkplainer has no user accounts, no login system, and no analytics. No cookies are used for tracking. No third-party analytics services (Google Analytics, Mixpanel, Hotjar, or similar) are used.

Your browser's `localStorage` stores one small piece of information: whether you have completed the onboarding tour. This data lives only on your device and is never sent anywhere.

---

## 3. Google Fonts

Inkplainer loads fonts from [Google Fonts](https://fonts.google.com). When your browser loads the app for the first time, it makes a request to Google's servers to download the font files.

As a result of this request, Google may log your IP address and the referring URL in accordance with [Google's privacy policy](https://policies.google.com/privacy). Inkplainer does not receive or have access to this data. This is standard behavior for any website that uses Google Fonts.

The fonts are cached by your browser after the first visit, so subsequent visits do not require a new request to Google's servers.

If you self-host Inkplainer and want to avoid this entirely, you can download the font files and serve them locally, then update the `<link>` tags in `index.html` accordingly.

---

## 4. MP4 export library

When you export in MP4 format, Inkplainer loads [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), a small open-source library, from jsDelivr (a free public CDN). This library runs entirely in your browser and handles packaging the video — no video data is sent anywhere.

jsDelivr may log your IP address when the library file is requested, as is standard for any CDN. If you export in WebM format instead, this library is not loaded and no request to jsDelivr is made.

If you self-host Inkplainer, you can also bundle `mp4-muxer` locally to avoid this external request.

---

## 5. Local storage and project data

Your Inkplainer projects; including all layers, settings, and images are saved in your browser's IndexedDB storage. This is local to your browser and device. It cannot be accessed remotely and is not synced to any cloud service.

Clearing your browser's site data will permanently delete your saved projects. Export important projects as video files or keep copies of your source images.

---

## 6. Third-party links

This repository and any deployment of Inkplainer may link to external sites (GitHub, jsDelivr, Google Fonts). Those sites have their own privacy policies. We are not responsible for the content or practices of any external site.

---

## 7. Children's privacy

Inkplainer does not knowingly collect any information from children under the age of 13. The app has no data collection of any kind, making it suitable for use in educational environments.

---

## 8. Changes to this policy

If meaningful changes are made to this policy — for example, if analytics or external services are added — this document will be updated and the "Last updated" date at the top will be revised.

---

## 9. Contact

For questions about this privacy policy, open an issue on GitHub: [github.com/NadirWeb-App](https://github.com/NadirWeb-App)

---

© 2026 Nadir · Apache 2.0 License

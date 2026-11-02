// Makes the placeholder screenshots for the Google step (public/onboarding/google/
// phone-1.png … laptop-4.png). Replace them with real screenshots, same names.
// Usage: node scripts/make-google-placeholders.mjs
import sharp from "sharp";
const steps = ["Search your restaurant", "Business Profile settings, People and access", "Add, then paste our email", "Choose Manager, then Invite"];
for (const device of ["phone", "laptop"]) {
  const [w, h] = device === "phone" ? [720, 1280] : [1280, 800];
  for (const [i, label] of steps.entries()) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<rect width="100%" height="100%" fill="#f5f5f4"/><rect x="24" y="24" width="${w - 48}" height="${h - 48}" rx="24" fill="none" stroke="#a8a29e" stroke-width="4" stroke-dasharray="16 12"/>
<text x="50%" y="42%" font-family="Arial, sans-serif" font-size="${device === "phone" ? 64 : 56}" font-weight="700" fill="#44403c" text-anchor="middle">Step ${i + 1}</text>
<text x="50%" y="52%" font-family="Arial, sans-serif" font-size="30" fill="#57534e" text-anchor="middle">${label}</text>
<text x="50%" y="60%" font-family="Arial, sans-serif" font-size="24" fill="#78716c" text-anchor="middle">Placeholder: replace with a ${device} screenshot</text></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(`public/onboarding/google/${device}-${i + 1}.png`);
  }
}
console.log("Made 8 placeholders in public/onboarding/google/");

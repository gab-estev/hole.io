import { renderPreview } from "./render.js";
renderPreview(document.querySelector("#preview"));
let mode = "login";
let busy = false;
const form = document.querySelector("#auth-form");
const error = document.querySelector("#auth-error");
const submit = document.querySelector("#auth-submit");
const password = document.querySelector("#password");
function setMode(next) {
  if (busy) return;
  mode = next;
  error.textContent = "";
  for (const action of ["login", "register"]) {
    const tab = document.querySelector(`#${action}-tab`);
    tab.classList.toggle("active", action === mode);
    tab.setAttribute("aria-pressed", String(action === mode));
  }
  document.querySelector("#auth-title").textContent =
    mode === "login" ? "Enter the void." : "Claim your spot.";
  submit.replaceChildren(
    document.createTextNode(
      mode === "login" ? "Log in & play" : "Create account & play",
    ),
    Object.assign(document.createElement("span"), { textContent: "↗" }),
  );
  password.autocomplete =
    mode === "login" ? "current-password" : "new-password";
  document.querySelector("#auth-note").textContent =
    mode === "login"
      ? "Your scores stay with you. Pick up where you left off."
      : "3–20 letters, numbers, or underscores. Password: 10–128 characters.";
}
document
  .querySelector("#login-tab")
  .addEventListener("click", () => setMode("login"));
document
  .querySelector("#register-tab")
  .addEventListener("click", () => setMode("register"));
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  submit.disabled = true;
  error.textContent = "";
  submit.textContent =
    mode === "login" ? "Signing in…" : "Creating your account…";
  try {
    const response = await fetch(`/api/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        username: document.querySelector("#username").value,
        password: password.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to sign in.");
    location.assign("/game");
  } catch (err) {
    error.textContent = err.message;
    busy = false;
    submit.disabled = false;
    const message = error.textContent;
    setMode(mode);
    error.textContent = message;
  }
});
fetch("/api/me")
  .then((res) => {
    if (res.ok) location.replace("/game");
  })
  .catch(() => {});

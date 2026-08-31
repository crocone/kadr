# Chrome Web Store listing — English

## Name

Kadr — screenshots & step guides

## Short description (132 characters max)

Capture any page, beautify the shot, redact private data offline. No trial, no watermarks,
no PRO lock.

## Category

Workflow & Planning

## Single purpose

Capturing and presenting screenshots of web pages. Everything in the extension serves that
one purpose: the capture modes produce the shot, the editor dresses it, the library keeps
it, the guide recorder turns a run through an interface into numbered steps, and the
tracker integration delivers the result.

## Full description

**Take the shot.** The whole page stitched from frames, the visible area, a region you drag
with a pixel magnifier, or a DOM element picked by hovering it. A responsive series shoots
375, 768 and 1440 px in one go and puts all three on one canvas.

**Make it presentable.** Backgrounds drawn in code — gradients, patterns, solids — margins,
corner radius, shadows, real macOS and Windows 11 browser frames with an editable url,
device bodies, and a mockup of your own. Save the whole look as a style preset and share the
JSON with your team.

**Explain it.** Arrows in seven styles, numbered step badges, spotlight, highlighter, text
with your local fonts, shapes and callouts. Blur stays a layer you can move or remove later
instead of pixels burnt into the image.

**Hide what should not be public.** Text recognition runs inside the browser — no key, no
server, no upload — and finds emails, phone numbers, cards and tokens for you to cover with
one click. Nothing is redacted without your confirmation, and nothing is ever a guarantee:
check the shot before you publish it.

**Send it where the work is.** A library with search by site, date, tag and the text
recognised on the shot. Copy as an image, as markdown or as a data URI. Export PNG, JPEG,
WebP or PDF. Or go straight to a GitHub, Linear or Jira issue with your own token — the
picture, the page url, the browser and the screen size come along.

**Bring your own AI, or none at all.** AI is off by default and makes no request until you
turn it on and enter a key. Any OpenAI-compatible endpoint works, including a local Ollama
or LM Studio, and the redaction pass above needs no AI at all.

**No telemetry.** Not a line about you goes anywhere: no counters, no analytics, no
"anonymous statistics". The extension makes exactly three kinds of network request, all of
them started by you: an AI action with your key, a one-time dictionary download for offline
text recognition, and sending a shot to the tracker you configured.

Open source, MIT: <https://github.com/crocone/kadr>

## Honest limits

- Chrome limits tab capture to about two frames per second, so a long page takes a while.
- Browser pages, the Web Store and other extensions' pages cannot be captured — a platform
  rule, not a bug.
- Virtualised lists (react-window and friends) break stitching: the DOM does not physically
  hold the rows that are off screen.
- The responsive series really resizes the window, and that is visible while it runs.

## Permission justifications

| Permission                    | Why                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`                   | Read the page being captured, at the moment the user starts a capture from the icon, menu or hotkey                                                                         |
| `scripting`                   | Inject the capture overlay and the page-measuring script into that tab                                                                                                      |
| `storage`, `unlimitedStorage` | Keep documents, shots and settings locally; screenshots are large and there are many                                                                                        |
| `downloads`                   | Save the exported file                                                                                                                                                      |
| `clipboardWrite`              | Copy the shot to the clipboard on the Copy button                                                                                                                           |
| `contextMenus`                | The right-click entry points into capture                                                                                                                                   |
| `offscreen`                   | Render and encode outside the service worker, which has no DOM                                                                                                              |
| Host access (`<all_urls>`)    | Optional, one site at a time and always behind a button: reshooting a saved shot, recording a step guide across pages, and sending to the issue tracker the user configured |
| `wasm-unsafe-eval` in the CSP | Offline text recognition compiles a WebAssembly module shipped inside the package; `eval()` and strings-as-code stay forbidden                                              |

## Privacy policy url

https://crocone.github.io/kadr/privacy.html

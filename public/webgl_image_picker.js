/* webgl_image_picker.js
   Minimal Image Picker for Unity WebGL (no preview/overlay)
   - Gallery button opens file picker (no capture)
   - Camera button opens native camera via temporary input[capture="environment"]
   - Resize/compress image client-side, chunk base64, send to Unity:
       GameObject: "ImageReceiver"
       Methods: "OnImageChunk", "OnImageTransferComplete"
   - Added: single-file only, and min-dimension check (MIN_SIZE)
*/

(function () {
  // ----- Config -----
  const UNITY_GAMEOBJECT = "ImageReceiver";
  const UNITY_METHOD_CHUNK = "OnImageChunk";
  const UNITY_METHOD_DONE = "OnImageTransferComplete";
  const CHUNK_SIZE = 32 * 1024; // 32KB per chunk
  const MAX_WIDTH = 1280; // resize max width (tweak if you want)
  const MAX_HEIGHT = 1280;
  const JPEG_QUALITY = 0.85;

  // NEW: minimum allowed dimension (either width or height must be >= MIN_SIZE)
  const MIN_SIZE = 200; // pixels, change if you want

  // ----- Small DOM helpers -----
  function qsel(id) { return document.getElementById(id); }
  function mk(tag, attrs = {}, parent = null) {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === "html") e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }

  // ----- Ensure UI (simple) -----
  // function ensureUI() {
  //   if (!qsel("webgl-image-picker-container")) {
  //     const cont = mk("div", { id: "webgl-image-picker-container" }, document.body);
  //     cont.style.display = "none";
  //     const style = document.createElement("style");
  //     style.innerHTML = `
  //       #webgl-image-picker-container {
  //         position: fixed;
  //         left: 12px;
  //         bottom: 12px;
  //         z-index: 999999;
  //         display: flex;
  //         flex-direction: column;
  //         gap: 8px;
  //         pointer-events: auto;
  //       }
  //       #webgl-image-picker-container button {
  //         padding: 8px 12px;
  //         font-size: 14px;
  //         background: rgba(0,0,0,0.65);
  //         color: #fff;
  //         border: none;
  //         border-radius: 8px;
  //         cursor: pointer;
  //         backdrop-filter: blur(6px);
  //       }
  //       #webgl-image-picker-container button:hover { opacity: 0.95; }
  //     `;
  //     document.head.appendChild(style);

  //     mk("button", { id: "webgl-open-gallery-btn", html: "📁 Chọn ảnh" }, cont);
  //     mk("button", { id: "webgl-open-camera-btn", html: "📷 Mở camera" }, cont);

  //     // Hidden input used for gallery (no capture attribute: opens gallery/folder)
  //     const hidden = mk("input", { id: "webgl-hidden-file-input", type: "file", accept: "image/*", style: "display:none" }, document.body);
  //     // ensure single-file only
  //     hidden.multiple = false;
  //     hidden.removeAttribute('multiple');
  //   }
  // }

  // ----- Unity send helpers -----
  function sendChunkToUnity(chunk) {
    try {
      if (window.unityInstance && window.unityInstance.SendMessage) {
        window.unityInstance.SendMessage(UNITY_GAMEOBJECT, UNITY_METHOD_CHUNK, chunk);
      } else if (window.SendMessage) {
        window.SendMessage(UNITY_GAMEOBJECT, UNITY_METHOD_CHUNK, chunk);
      } else {
        console.warn("Unity instance not ready; chunk not sent now.");
      }
    } catch (e) {
      console.error("SendMessage error:", e);
    }
  }

  function notifyUnityComplete() {
    try {
      if (window.unityInstance && window.unityInstance.SendMessage) {
        window.unityInstance.SendMessage(UNITY_GAMEOBJECT, UNITY_METHOD_DONE, "");
      } else if (window.SendMessage) {
        window.SendMessage(UNITY_GAMEOBJECT, UNITY_METHOD_DONE, "");
      } else {
        console.warn("Unity instance not ready for complete notify.");
      }
    } catch (e) {
      console.error("NotifyComplete error:", e);
    }
  }

  // ----- Image processing (resize + toDataURL) -----
  function stripDataUrlPrefix(dataUrl) {
    const idx = dataUrl.indexOf("base64,");
    return idx >= 0 ? dataUrl.substring(idx + 7) : dataUrl;
  }

  // This function first checks the original image dimensions and rejects if either dimension < MIN_SIZE
  function resizeFileToDataUrl(file, maxW = MAX_WIDTH, maxH = MAX_HEIGHT, quality = JPEG_QUALITY) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const origW = img.width, origH = img.height;
          // If either width OR height is smaller than MIN_SIZE, reject
          if (origW < MIN_SIZE || origH < MIN_SIZE) {
            const err = new Error("MIN_DIMENSION");
            err.width = origW;
            err.height = origH;
            return reject(err);
          }

          let w = origW, h = origH;
          const aspect = w / h;
          if (w > maxW) { w = maxW; h = Math.round(w / aspect); }
          if (h > maxH) { h = maxH; w = Math.round(h * aspect); }
          const cvs = document.createElement("canvas");
          cvs.width = w;
          cvs.height = h;
          const ctx = cvs.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          cvs.toBlob(blob => {
            if (!blob) {
              reject(new Error("Canvas toBlob returned null"));
              return;
            }
            const r2 = new FileReader();
            r2.onerror = reject;
            r2.onload = () => resolve(r2.result);
            r2.readAsDataURL(blob);
          }, "image/jpeg", quality);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ----- Send image (base64 chunked) -----
  async function sendBase64ToUnity(base64String) {
    for (let i = 0; i < base64String.length; i += CHUNK_SIZE) {
      const chunk = base64String.substr(i, CHUNK_SIZE);
      sendChunkToUnity(chunk);
    }
    notifyUnityComplete();
  }

  async function sendFileToUnity(file) {
    try {
      const dataUrl = await resizeFileToDataUrl(file);
      const base64 = stripDataUrlPrefix(dataUrl);
      await sendBase64ToUnity(base64);
    } catch (e) {
      if (e && e.message === "MIN_DIMENSION") {
        alert(`Ảnh quá nhỏ: kích thước thực tế ${e.width}x${e.height}px. Vui lòng chọn ảnh có chiều rộng và chiều cao tối thiểu ${MIN_SIZE}px.`);
        return;
      }
      console.error("sendFileToUnity error:", e);
      alert("Không thể xử lý ảnh. Kiểm tra console.");
    }
  }

  // ----- Gallery handling (picker) -----
  // function setupGalleryHandlers() {
  //   const galleryBtn = qsel("webgl-open-gallery-btn");
  //   const hiddenInput = qsel("webgl-hidden-file-input");
  //   if (!galleryBtn || !hiddenInput) return;

  //   // ensure single-file only
  //   hiddenInput.multiple = false;
  //   hiddenInput.removeAttribute('multiple');

  //   galleryBtn.addEventListener("click", () => {
  //     // reset value and open file picker
  //     hiddenInput.value = "";
  //     hiddenInput.click();
  //   });

  //   hiddenInput.addEventListener("change", (ev) => {
  //     // Only take the first file even if browser allowed multiple
  //     const f = ev.target.files && ev.target.files[0];
  //     if (f) sendFileToUnity(f);
  //     ev.target.value = "";
  //   });
  // }

  // ----- Camera handling (open native camera app directly) -----
  // function setupCameraHandler() {
  //   const cameraBtn = qsel("webgl-open-camera-btn");
  //   if (!cameraBtn) return;

  //   cameraBtn.addEventListener("click", async () => {
  //     try {
  //       // create temporary input that requests capture from device camera
  //       const input = document.createElement("input");
  //       input.type = "file";
  //       input.accept = "image/*";
  //       // hint to open rear camera; some browsers/platforms respect it
  //       input.setAttribute("capture", "environment");
  //       // ensure single-file only
  //       input.multiple = false;
  //       input.removeAttribute('multiple');
  //       input.style.display = "none";
  //       document.body.appendChild(input);

  //       input.addEventListener("change", async (ev) => {
  //         // Only take the first file
  //         const f = ev.target.files && ev.target.files[0];
  //         if (f) {
  //           await sendFileToUnity(f);
  //         }
  //         // cleanup
  //         if (input.parentNode) input.parentNode.removeChild(input);
  //       }, { once: true });

  //       // Trigger native camera / photo app
  //       input.click();
  //     } catch (e) {
  //       console.error("Failed to open native camera:", e);
  //       alert("Không thể mở camera gốc. Hãy kiểm tra quyền truy cập hoặc trình duyệt.");
  //     }
  //   });
  // }

  // ----- Initialization -----
  function init() {
    //ensureUI();
    // setupGalleryHandlers();
    // setupCameraHandler();

    // Expose helpers for debugging or manual calls
    window.WebGLImagePicker = {
      sendFileToUnity,
      sendBase64ToUnity,
    };

    console.log(`WebGL Image Picker (minimal, no preview) initialized. MIN_SIZE=${MIN_SIZE}px`);
  }

  (function () {

    let cameraPermissionChecked = false;

    async function ensureCameraPermission() {
      if (cameraPermissionChecked) return true;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(t => t.stop());
        cameraPermissionChecked = true;
        return true;
      } catch (e) {
        console.warn("Camera permission denied", e);
        return false;
      }
    }

    // =========================
    // Open Native Camera
    // =========================
    window.WebGLImagePicker_OpenCamera = async function () {
      try {
        const ok = await ensureCameraPermission();
        if (!ok) {
          notifyPermissionDenied();
          return;
        }

        openFileInput(true);
      } catch (e) {
        console.error("OpenCamera failed:", e);
      }
    };

    // =========================
    // Open Gallery
    // =========================
    window.WebGLImagePicker_OpenGallery = async function () {
      try {
        // Dù là gallery, vẫn xin permission camera
        // để tránh browser edge-case
        await ensureCameraPermission();

        openFileInput(false);
      } catch (e) {
        console.error("OpenGallery failed:", e);
      }
    };

    // =========================
    // Shared input handler
    // =========================
    function openFileInput(useCamera) {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "image/*";
      inp.multiple = false;

      if (useCamera) {
        inp.setAttribute("capture", "environment");
      }

      inp.style.display = "none";
      document.body.appendChild(inp);

      inp.addEventListener("change", async (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (f) await sendFileToUnity(f);

        inp.remove();
      }, { once: true });

      inp.click();
    }

    function notifyPermissionDenied() {
      if (typeof UnitySendMessage === "function") {
        UnitySendMessage(
          "ImageReceiver",
          "OnCameraPermissionDenied",
          ""
        );
      }
    }

  })();

  // using System.Runtime.InteropServices;

  // public class ImagePickerBridge : MonoBehaviour
  // {
  //     [DllImport("__Internal")]
  //     private static extern void WebGLImagePicker_OpenGallery();

  //     [DllImport("__Internal")]
  //     private static extern void WebGLImagePicker_OpenCamera();

  //     public void OpenGallery() => WebGLImagePicker_OpenGallery();
  //     public void OpenCamera() => WebGLImagePicker_OpenCamera();
  // }
  // mergeInto(LibraryManager.library, {
  //   WebGLImagePicker_OpenGallery: function () {
  //     window.WebGLImagePicker_OpenGallery();
  //   },
  //   WebGLImagePicker_OpenCamera: function () {
  //     window.WebGLImagePicker_OpenCamera();
  //   }
  // });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();

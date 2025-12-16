const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 8080;
const ROOT = path.join(__dirname, "public");
const BUILD = path.join(ROOT, "Build");

// ===== Serve Unity WebGL gzip files DIRECTLY =====
app.get("/Build/:file", (req, res) => {
  const file = req.params.file;
  const filePath = path.join(BUILD, file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Not found");
  }

  // Set headers ONLY for .gz files
  if (file.endsWith(".gz")) {
    res.setHeader("Content-Encoding", "gzip");

    if (file.endsWith(".framework.js.gz") || file.endsWith(".loader.js.gz")) {
      res.setHeader("Content-Type", "application/javascript");
    } else if (file.endsWith(".wasm.gz")) {
      res.setHeader("Content-Type", "application/wasm");
    } else if (file.endsWith(".data.gz")) {
      res.setHeader("Content-Type", "application/octet-stream");
    }
  }

  res.sendFile(filePath);
});

// ===== Serve index.html, loader.js, TemplateData =====
app.use(express.static(ROOT));

app.listen(PORT, () => {
  console.log(`🚀 Unity WebGL (gzip-direct) running at http://localhost:${PORT}`);
});

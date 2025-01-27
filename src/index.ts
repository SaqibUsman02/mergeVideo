import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static"; // Import ffmpeg-static
import fs from "fs";
import path from "path";

const app = express();
const PORT = 3000;

// Set FFmpeg path from ffmpeg-static
ffmpeg.setFfmpegPath(ffmpegStatic!);

// Configure Multer for file uploads
const uploadFolder = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder);
}
const upload = multer({ dest: uploadFolder });

// Serve uploads folder as static files
app.use("/uploads", express.static(uploadFolder));

// API: Upload a Video
app.post("/upload", upload.single("video"), (req: any, res: any) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file uploaded." });
  }

  const originalExtension = path.extname(req.file.originalname);
  const newFileName = `${req.file.filename}${originalExtension}`;
  const newFilePath = path.join(uploadFolder, newFileName);

  fs.renameSync(req.file.path, newFilePath);

  const videoUrl = `/uploads/${newFileName}`;
  res.send(`
    <html>
      <body>
        <h1>Video Uploaded Successfully</h1>
        <video width="640" height="360" controls>
          <source src="${videoUrl}" type="${req.file.mimetype}">
          Your browser does not support the video tag.
        </video>
        <p><a href="${videoUrl}" download>Download Video</a></p>
      </body>
    </html>
  `);
});

// API: Combine Videos
app.post("/combine", async (req: any, res: any) => {
  try {
    const files = fs
      .readdirSync(uploadFolder)
      .filter((file) => file.endsWith(".mp4"))
      .map((file) => path.join(uploadFolder, file));

    if (files.length < 2) {
      return res.status(400).json({ error: "At least two videos are required to combine." });
    }

    const listFilePath = path.join(uploadFolder, "file_list.txt");
    const combinedVideoPath = path.join(uploadFolder, "combined_output.mp4");

    // Create the text file listing all video files
    const listContent = files.map((file) => `file '${file}'`).join("\n");
    fs.writeFileSync(listFilePath, listContent);

    // Combine the videos using FFmpeg
    ffmpeg()
      .input(listFilePath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .output(combinedVideoPath)
      .on("end", () => {
        res.json({
          message: "Videos combined successfully.",
          combinedVideoPath: `http://localhost:${PORT}/uploads/combined_output.mp4`,
        });
      })
      .on("error", (err) => {
        console.error("Error combining videos:", err);
        res.status(500).json({ error: "Failed to combine videos.", details: err.message });
      })
      .run();
  } catch (error: any) {
    console.error("Error:", error);
    res.status(500).json({ error: "Server error.", details: error.message });
  }
});

// Start the Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

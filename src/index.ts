import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import fs from "fs";
import path from "path";
import http from "http";

const app = express();
const PORT = 3003;

app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

// ✅ Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic!);

// ✅ Define a static uploads folder
const uploadFolder = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder);
}

// ✅ Configure Multer for file uploads
const upload = multer({ dest: uploadFolder });
app.use((req, res, next) => {
  req.setTimeout(15 * 60 * 1000); // 15 minutes timeout
  res.setTimeout(15 * 60 * 1000, () => {
    console.log("❌ Response Timeout");
    res.status(408).json({ error: "Request Timeout. Try again with a smaller file." });
  });
  next();
});

const addSubtitles = (videoPath: string, srtPath: string, outputPath: string, callback: Function) => {
  console.log("🔄 Adding Subtitles...");

  // Convert paths to absolute paths & fix Windows paths
  const absoluteVideoPath = path.resolve(videoPath).replace(/\\/g, "/").trim();
  const absoluteSrtPath = path.resolve(srtPath).replace(/\\/g, "/").trim();
  const absoluteOutputPath = path.resolve(outputPath).replace(/\\/g, "/").trim();

  console.log("📌 Absolute Video Path:", absoluteVideoPath);
  console.log("📌 Absolute Subtitle Path:", absoluteSrtPath);
  console.log("📌 Absolute Output Path:", absoluteOutputPath);

  // Verify if files exist
  if (!fs.existsSync(absoluteVideoPath)) {
    console.error("❌ Video file NOT found:", absoluteVideoPath);
    return callback(true, "Video file not found.");
  }
  if (!fs.existsSync(absoluteSrtPath)) {
    console.error("❌ Subtitle file NOT found:", absoluteSrtPath);
    return callback(true, "Subtitle file not found.");
  }

  // 🔥 Run FFmpeg with properly formatted paths
  ffmpeg(absoluteVideoPath)  // ✅ Use absolute path
    .videoCodec("libx264")
    .audioCodec("aac")
    .outputOptions([
      "-vf", `subtitles='${absoluteSrtPath.replace(/:/g, '\\:')}'`,
      "-c:a", "copy"
    ])
    .on("start", (cmd) => console.log("⚡ FFmpeg Command:", cmd))
    .on("stderr", (stderrLine) => console.error("🔴 FFmpeg Log:", stderrLine))
    .on("error", (err) => {
      console.error("🔴 FFmpeg Error:", err);
      callback(true, err);
    })
    .on("end", () => {
      console.log("✅ Subtitle Added Successfully!");
      callback(false, absoluteOutputPath);
    })
    .save(absoluteOutputPath);
};

app.post("/api/upload", upload.single("video"), (req: any, res: any) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file uploaded." });
  }

  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: "No subtitle text provided." });
  }
  console.log("question", question);


  const videoFilename = path.parse(req.file.filename).name;
  const originalPath = req.file.path;
  const videoPath = path.join(uploadFolder, `${videoFilename}.mp4`);
  fs.renameSync(originalPath, videoPath);

  const srtPath = path.join(uploadFolder, `${videoFilename}.srt`);
  const outputVideoPath = path.join(uploadFolder, `output_${videoFilename}.mp4`);

  console.log("📌 Renamed Video Path:", videoPath);
  console.log("📌 Subtitle Path:", srtPath);
  console.log("📌 Output Video Path:", outputVideoPath);

  // ✅ Create subtitle file
  fs.writeFileSync(srtPath, `1\n00:00:00,000 --> 99:00:00,000\n${question}`, "utf8");

  // ✅ Check if subtitle file exists
  if (!fs.existsSync(srtPath)) {
    console.error("❌ Subtitle file NOT found:", srtPath);
    return res.status(500).json({ error: "Subtitle file not found." });
  } else {
    console.log("✅ Subtitle file exists:", srtPath);
  }

  // ✅ Run FFmpeg
  addSubtitles(videoPath, srtPath, outputVideoPath, (error: boolean, newFilePath: string) => {
    if (error) {
      return res.status(500).json({ error: "Failed to add subtitles." });
    }
    const outputFileName = path.basename(newFilePath);

    res.json({
      message: "Video uploaded with subtitles successfully.",
      videoUrl: `http://localhost:${PORT}/uploads/${outputFileName}`,
      fileName: outputFileName,
    });
  });
});

app.post("/api/combine", async (req: any, res: any) => {
  try {
    console.log("body is", req);

    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length < 2) {
      return res.status(400).json({ error: "At least two video files are required to combine." });
    }

    // ✅ Convert filenames to full paths
    const filePaths = files.map((file) => path.join(uploadFolder, file.name));

    // ✅ Verify that all files exist
    const missingFiles = filePaths.filter((file) => !fs.existsSync(file));
    if (missingFiles.length > 0) {
      return res.status(400).json({ error: "Some files do not exist.", missingFiles });
    }

    const listFilePath = path.join(uploadFolder, "file_list.txt");
    const combinedVideoPath = path.join(uploadFolder, "combined_output.mp4");

    // ✅ Create the file list for FFmpeg
    const listContent = filePaths.map((file) => `file '${file}'`).join("\n");
    fs.writeFileSync(listFilePath, listContent);

    // ✅ Run FFmpeg to combine videos
    ffmpeg()
      .input(listFilePath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .output(combinedVideoPath)
      .on("end", () => {
        res.json({
          message: "Videos combined successfully.",
          combinedVideoUrl: `http://localhost:${PORT}/uploads/combined_output.mp4`,
        });
      })
      .on("error", (err) => {
        console.error("❌ Error combining videos:", err);
        res.status(500).json({ error: "Failed to combine videos.", details: err.message });
      })
      .run();
  } catch (error: any) {
    console.error("❌ Server Error:", error);
    res.status(500).json({ error: "Server error.", details: error.message });
  }
});

app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Server is running!",
    timestamp: new Date().toISOString(),
  });
});


// ✅ Serve video files
app.use("/uploads", express.static(uploadFolder));
const server = http.createServer(app);

server.timeout = 0;
server.keepAliveTimeout = 0;

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
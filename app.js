const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("fluent-ffmpeg");
const ytdl = require("ytdl-core");
const youtubedl = require("youtube-dl-exec");
const ffmpegPath = require("ffmpeg-static"); 
const axios = require('axios')
const FormData = require("form-data"); 
require("dotenv").config();

// const cloudinary  =require('cloudinary')
// Import ffmpeg-static path

const MEGAFILE_API_URL = "https://megafile.in/api/v2/file/upload"; // Replace with actual API endpoint
const MEGAFILE_API_KEY = "Uv2ql7Rix0MLK2udDD5gRms861hflKkzCRlocR95Tph0yCI236x6jktf2ykTvDrp"; // Replace with your MegaFile.io API key


// Set the FFmpeg path to the one provided by ffmpeg-static
ffmpeg.setFfmpegPath(ffmpegPath);

// cloudinary.config({
//   cloud_name: 'dzki5rtol',
//   api_key: '733963939534142',
//   api_secret: 'qjvO1tlztcqWmn5gcwzhguQOwFg',
// });

const baseUrl = process.env.BASE_URL;

const app = express();
const port = process.env.PORT||3000;
const tempDir = "./temp";
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Enable CORS
const corsOptions = {
  origin: ["http://localhost:5173", "https://youtubevideotomp3.netlify.app/"], // Add your allowed domains
  methods: ["GET", "POST"],
};
app.use(cors(corsOptions));

// Middleware
app.use(bodyParser.json());


// Function to upload a file to MegaFile.io
const uploadToMegaFile = async (filePath) => {
  const fileName = path.basename(filePath);

  // Create a form using the form-data package
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath)); // Attach the file
  formData.append("api_key", MEGAFILE_API_KEY); // Add the API key
console.log(formData)
  try {
    const response = await axios.post(MEGAFILE_API_URL, formData, {
      headers: {
        ...formData.getHeaders(), // Proper headers for multipart form-data
      },
    });

    // Handle the response
    if (response.data.success) {
      console.log("File uploaded successfully:", response.data);
      return response.data.result.url; // Return the URL of the uploaded file
    } else {
      console.error("Upload failed with message:", response.data.message);
      throw new Error(`Upload failed: ${response.data.message}`);
    }
  } catch (error) {
    // Log detailed error information
    console.error("Error uploading to MegaFile.io:", error.message,error);

    // If the error is from the response, log the full response
    if (error.response) {
      console.error("Response error details:", error.response.data);
    }

    // If the error is from the request, log the request details
    if (error.request) {
      console.error("Request error details:", error.request);
    }

    throw error;
  }
};

// Function to download YouTube videos using youtube-dl-exec
const downloadYouTubeVideo = (videoUrl, outputFilePath) => {
  return new Promise((resolve, reject) => {
    youtubedl(videoUrl, {
      output: outputFilePath,
      format: "mp4", // Explicitly request mp4 format
    })
      .then(() => {
        console.log(`Downloaded video to ${outputFilePath}`);
        resolve();
      })
      .catch((error) => {
        console.error("Error downloading video:", error);
        reject(error);
      });
  });
};


const deleteFile = (filePath) => {
  fs.unlink(filePath, (err) => {
    if (err) console.error(`Error deleting file: ${filePath}`, err);
  });
};

// Video processing endpoint
const trimVideo = (
  inputFilePath,
  startTimeInSeconds,
  durationInSeconds,
  trimmedFilePath
) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputFilePath)
      .setStartTime(startTimeInSeconds)
      .setDuration(durationInSeconds)
      .output(trimmedFilePath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
};

// Function to extract audio from the video using ffmpeg
const extractAudio = (trimmedFilePath, audioFilePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(trimmedFilePath)
      .noVideo()
      .format("mp3")
      .output(audioFilePath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
};


const parseTime = (timeStr) => {
    console.log(timeStr)
  const time = parseFloat(timeStr);

  // If the input is a valid number
  if (isNaN(time)) {
    throw new Error("Invalid time format. Please provide a valid number.");
  }

  // If there's no decimal, it's in seconds
  if (!timeStr.includes('.')) {
    return time; // Return as seconds
  }

  // If there's a decimal, treat it as minutes and seconds
  const [minutes, seconds] = timeStr.split(".");
  const minutesInSeconds = parseInt(minutes, 10) * 60; // Convert minutes to seconds
  const secondsValue = parseInt(seconds, 10); // Get the seconds part

  return minutesInSeconds + secondsValue; // Total time in seconds
};

app.post("/download-and-trim", async (req, res) => {
  const { videoUrl, startTime, endTime } = req.body;

  // Validate input
  if (!videoUrl || !ytdl.validateURL(videoUrl)) {
    return res.status(400).json({ error: "Invalid YouTube URL." });
  }

  try {
    // Parse and convert startTime and endTime to seconds
    const startTimeInSeconds = parseTime(`${startTime}`);
    const endTimeInSeconds = parseTime(`${endTime}`);

    if (isNaN(startTimeInSeconds) || isNaN(endTimeInSeconds)) {
      return res.status(400).json({ error: "Invalid time format provided." });
    }

    const durationInSeconds = endTimeInSeconds - startTimeInSeconds;
    if (durationInSeconds <= 0) {
      return res
        .status(400)
        .json({ error: "End time must be greater than start time." });
    }

    const fileId = uuidv4();
    const inputFilePath = path.join(tempDir, `${fileId}-input.mp4`);

    console.log(`Downloading video from: ${videoUrl}`);
    // Download YouTube video
    await downloadYouTubeVideo(videoUrl, inputFilePath);

    const trimmedFilePath = path.join(tempDir, `${fileId}-trimmed.mp4`);
    console.log(
      `Trimming video: ${startTimeInSeconds}s to ${endTimeInSeconds}s`
    );
    // Trim the video using ffmpeg (or similar tool)
    await trimVideo(
      inputFilePath,
      startTimeInSeconds,
      durationInSeconds,
      trimmedFilePath
    );

    const audioFilePath = path.join(tempDir, `${fileId}.mp3`);
    console.log(`Extracting audio from trimmed video`);
    // Extract audio from trimmed video
    await extractAudio(trimmedFilePath, audioFilePath);

    // Clean up temporary video file
    fs.unlinkSync(inputFilePath);
    fs.unlinkSync(trimmedFilePath);

    // Send the audio file directly as a response for download
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename=${fileId}.mp3`);
    fs.createReadStream(audioFilePath).pipe(res);

    // Optional: Delete the file after it's sent to avoid leaving it on the server
    res.on("finish", () => {
      fs.unlinkSync(audioFilePath);
    });
  } catch (error) {
    console.error("Error:", error.message);
    res
      .status(500)
      .json({ error: "An error occurred while processing the video." });
  }
});

// Download endpoint
app.get("/download/:filename", (req, res) => {
  const filePath = path.join(tempDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: "File not found." });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

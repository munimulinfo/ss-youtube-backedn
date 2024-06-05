const express = require("express");
const app = express();
const cors = require("cors");
const ytdl = require("ytdl-core");
const { chain, forEach } = require("lodash");
const ffmpegPath = require("ffmpeg-static");
const { spawn } = require("child_process");
const sanitize = require("sanitize-filename");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

app.use(express.json());

if (process.env.mode === "production") {
  app.use(cors());
} else {
  app.use(
    cors({
      origin: "http://localhost:5173",
    })
  );
}

const getResu = (formats) => {
  let resuArray = [];

  for (let i = 0; i < formats.length; i++) {
    if (formats[i].qualityLabel !== null) {
      resuArray.push(formats[i]);
    }
  }

  return [...new Set(resuArray.map((v) => v.height))];
};

app.post("/api/get-video-info", async (req, res) => {
  const { url } = req.body;

  try {
    const { videoDetails, formats } = await ytdl.getInfo(url);
    const { title, thumbnails, lengthSeconds } = videoDetails;
    const videoResu = getResu(formats);

    return res.status(200).json({
      videoInfo: {
        title,
        lengthSeconds,
        thumbnailUrl: thumbnails[thumbnails.length - 1].url,
        videoResu,
        lastResu: videoResu[0],
      },
    });
  } catch (error) {
    res.status(400).json({ error: "Invalid YouTube URL" });
  }
});

app.get("/video-download", async (req, res) => {
  const { id, resu } = req.query;
  if (!id) {
    throw new Error("Invalid Url");
  }
  try {
    const {
      videoDetails: { title },
      formats,
    } = await ytdl.getInfo(id);
    const videoFormate = chain(formats)
      .filter(
        ({ height, codecs }) =>
          height && height === parseInt(resu) && codecs?.startsWith("avc1")
      )
      .orderBy("fps", "desc")
      .head()
      .value();

    const streams = {};

    streams.video = ytdl(id, { quality: videoFormate.itag });
    streams.audio = ytdl(id, { quality: "highestaudio" });

    const pipes = {
      out: 1,
      err: 2,
      video: 3,
      audio: 4,
    };

    const ffmpegInputOption = {
      video: [
        "-i",
        `pipe:${pipes.video}`,
        "-i",
        `pipe:${pipes.audio}`,
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-c:v",
        "copy",
        "-c:a",
        "libmp3lame",
        "-crf",
        "27",
        "-preset",
        "veryfast",
        "-movflags",
        "frag_keyframe+empty_moov",
        "-f",
        "mp4",
      ],
    };
    const ffmpegOption = [
      ...ffmpegInputOption.video,
      "-loglevel",
      "error",
      "-",
    ];

    const ffmpegProcess = spawn(ffmpegPath, ffmpegOption, {
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    });
    const errorHendle = (err) => console.log(err);
    forEach(streams, (stream, format) => {
      const dest = ffmpegProcess.stdio[pipes[format]];
      stream.pipe(dest).on("error", errorHendle);
    });

    ffmpegProcess.stdio[pipes.out].pipe(res);
    let ffmpegLog = "";

    ffmpegProcess.stdio[pipes.err].on(
      "data",
      (chunk) => (ffmpegLog += chunk.toString())
    );

    ffmpegProcess.on("exit", (exitCode) => {
      if (exitCode === 1) {
        console.log(ffmpegLog);
      }
      res.end();
    });

    ffmpegProcess.on("close", () => ffmpegProcess.kill());

    const filename = `${encodeURI(sanitize(title))}.mp4`;

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment;filename=${filename};filename*=uft-8''${filename}`
    );
  } catch (error) {
    res.status(400).json({ error: "Invalid YouTube URL " });
  }
});

if (process.env.mode === "production") {
  app.use(express.static(path.join(__dirname, "./client/build")));

  app.get("*", (req, res) => {
    res.send("server is running on port 5000");
  });
}

const port = process.env.port;
app.listen(port, () => console.log(`Server is running on port ${port}!`));

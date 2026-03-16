To asynchronously render a 2-to-15 minute HTML5/Canvas animation (PixiJS + VexFlow) synced to an MP3, you are dealing with a heavy, long-running process. It requires spinning up a headless browser, recording the canvas, muxing it with audio, and uploading it.

The Exact Video Export Stack
The Host: Railway

Why: You need a platform that natively supports custom Dockerfiles (because he has to install FFmpeg and Google Chrome on the server) and has no timeouts. Railway gives you Vercel-like deployment speed but acts like a real server.

The Queue: BullMQ + Upstash Redis

Why: Rendering a 15-minute video takes massive CPU/RAM. If 5 users hit "Export" at the same time, the server will crash. BullMQ puts the jobs in a line. The worker processes them one by one. Upstash is serverless Redis that takes 10 seconds to set up.

The Engine: Puppeteer + FFmpeg

Why: The only way to server-side render a web canvas animation is to open a hidden browser on the server, play the animation, record the frames, and stitch them together with the MP3.

The Exact Workflow (How it actually works)
The user hits "Export" on the Vercel frontend.

Vercel drops a job containing the song_id and the audio_url into the Redis queue and immediately tells the user, "Your video is rendering."

The Railway worker picks up the job. It uses Puppeteer to open a hidden, UI-free route on your Vercel app (e.g., yourdomain.com/render-view?id=123).

The worker uses the browser's native MediaRecorder API to record the canvas as a .webm video stream directly to the Railway server's local disk.

The worker uses FFmpeg to mux that .webm video file with the user's .mp3 audio file into a clean .mp4.

The worker uploads the final .mp4 to Cloudflare R2 using the AWS S3 SDK.

The worker updates the Supabase database row to status: 'completed', which triggers a real-time UI update on the user's screen.

Project: Video Rendering Pipeline
Deadline: Friday EOD

Here is the architecture for the asynchronous video export. I don't want to spend time evaluating platforms. We are building a dedicated background worker to keep this heavy compute off of Vercel.

Queue: Set up an Upstash Redis database and use BullMQ. When a user exports, the Next.js app drops a job in the queue.

Worker Host: Deploy a Node.js Background Worker on Railway.

The Engine: Write a Dockerfile for the Railway worker that installs Puppeteer and FFmpeg.

The Logic: The worker pulls a job, opens our app in headless Chrome, records the canvas using MediaRecorder, muxes it with the MP3 using FFmpeg, and pushes the final MP4 directly to Cloudflare R2. Then it updates Supabase so the frontend knows it's done.


Project Brief: Ultimate Pianist Video Export Engine
Target Deadline: Friday EOD

The Goal:
We need an asynchronous video export pipeline for the Ultimate Pianist web app. Users need to be able to export 2-to-15 minute 1080p videos of their sheet music and falling notes animation, perfectly synced with their uploaded MP3s.

The Constraints (Do Not Over-Engineer):

No Vercel for Compute: Vercel will time out and hit payload limits. Keep the heavy lifting off the frontend.

No Client-Side Rendering: We are not using SharedArrayBuffer or forcing the user's browser to render video. It must be deterministic and server-side to prevent audio desync and customer support nightmares.

Zero Egress: All final MP4s must go directly to Cloudflare R2.

The Locked Architecture:

Database & Auth: Supabase (Already built, use the shared schemas).

Frontend: Next.js.

Queue: Upstash Redis + BullMQ.

Worker Host: Railway (Dockerized Node.js environment).

Render Engine: Puppeteer + FFmpeg.

The Execution Flow:

Next.js UI drops an export job (with song_id and MP3 URL) into the Redis queue.

The Railway worker picks up the job.

Worker opens a headless Chrome instance (Puppeteer) to a hidden render route on our app.

Worker records the canvas perfectly, frame-by-frame.

Worker uses FFmpeg to mux the visual canvas recording with the user's MP3.

Worker uploads the final .mp4 to Cloudflare R2.

Worker updates the Supabase job row to status: 'completed', updating the user's UI.


1. Slaying the "Zombie Chrome" Processes
Puppeteer (Headless Chrome) is a notorious memory hog. If a user's render job fails halfway through, Chrome doesn't always close. It leaves a "zombie" process running on the server. After 20 failed jobs, your Railway server runs out of RAM, crashes, and takes the entire queue down with it.

The 24-Hour Fix: browser.close()

The 5-Day Fix: Thomas has to build custom teardown logic, memory-limit watchers, and Docker-level process managers (like dumb-init) to ensure Chrome is ruthlessly assassinated if a job hangs.



3. Handling Queue Concurrency (The Viral Problem)
What happens if you post a TikTok, it goes viral, and 500 people hit "Export Video" at the exact same time?

The 24-Hour Fix: The Railway server tries to open 500 instances of Chrome, instantly runs out of memory, and dies. Everyone gets a "Failed" message.

The 5-Day Fix: Thomas configures BullMQ with strict concurrency limits. He sets up job stalling, automatic retries, and a WebSocket connection back to the Next.js frontend so the user sees: "You are #42 in the render queue. Estimated time: 4 minutes."




The "Deterministic" Boss Battle: Don't just run a real-time MediaRecorder on the server. He will hijack the browser's clock. Instead of letting the animation play out in real-time, his script will advance the animation exactly 16.6 milliseconds (1 frame at 60fps), take a perfect screenshot, advance another 16.6ms, take a screenshot, and then hand all those perfect frames to FFmpeg to stitch together.



The Video Export Strategy (Deterministic Rendering)

For the video export, do NOT use MediaRecorder or try to capture it in real-time. The server will drop frames and desync the audio when the big chords hit.

We are doing deterministic, frame-by-frame rendering.

Hijack the Clock: In the headless Puppeteer instance, inject a script that mocks window.performance.now and Date.now.

Mute the Browser: We don't need the browser to play the audio. We already have the MP3 file. The browser is strictly rendering the visual canvas (PixiJS + VexFlow).

Step and Capture: Advance your mocked clock by exactly 1000/60 milliseconds (16.66ms for 60fps). Wait for the React/Pixi render loop to settle, grab the frame buffer (via Puppeteer screenshot or pulling raw canvas pixels), and pipe it directly into standard input (stdin) of an FFmpeg process.

Mux it: FFmpeg takes that stream of perfect image frames, stitches them to the original MP3, and outputs the final .mp4 to Cloudflare R2.*

It might take 3 minutes to render a 1-minute song, but the output will be a mathematically flawless 60fps with zero lag or desync."


Looking at the PlaybackManager.ts file in your repo, this is going to be surprisingly clean for him to implement because you already decoupled the visual time from the audio time (getVisualTime() vs getTime()). He just has to override that specific class during the headless render.



1. The "Puppeteer in Docker" Final Boss
You can't just run npm install puppeteer on a Railway server and expect it to work. Puppeteer downloads a local version of Chromium, which requires about 30 different obscure Linux shared libraries (libnss3, libatk1.0, libxss1, etc.) to actually launch.

The Trap: You will deploy to Railway, the build will pass, and the moment you hit "Export," the server logs will throw a fatal error because Chrome failed to launch in headless mode. You have to write a custom Dockerfile or use specific Nixpacks just to get the browser to open.

2. The FFmpeg Memory Leak
If you are capturing a 3-minute song at 60fps, that is 10,800 individual image frames.

The Trap: If you try to hold those frames in an array in Node.js memory before passing them to FFmpeg, your server will hit an OOM (Out Of Memory) crash instantly. You have to spawn a child process for FFmpeg and pipe the raw image buffers directly into its stdin as they are generated, letting it encode on the fly.

3. The React Hydration Wait
You are loading an offline React app inside this headless browser.

The Trap: If you start capturing frames the millisecond the page loads, you are going to get a video of a blank white screen. You have to write logic to inject into the page, wait for the DOM to mount, wait for the PixiJS canvas to initialize, and then start the clock hijack.
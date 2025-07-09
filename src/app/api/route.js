import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import cfCheck from "@/utils/cfCheck";
import {
  localExecutablePath,
  isDev,
  userAgent,
  remoteExecutablePath,
} from "@/utils/utils";

export const maxDuration = 60; // This function can run for a maximum of 60 seconds (update by 2024-05-10)
export const dynamic = "force-dynamic";

const chromium = require("@sparticuz/chromium-min");
const puppeteer = require("puppeteer-core");

export async function GET(request) {
  const url = new URL(request.url);
  const urlStr = url.searchParams.get("url");
  const width = parseInt(url.searchParams.get("width")) || 1920;
  const height = parseInt(url.searchParams.get("height")) || 1080;
  if (!urlStr) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 }
    );
  }

  let browser = null;
  try {
    browser = await puppeteer.launch({
      ignoreDefaultArgs: ["--enable-automation"],
      args: isDev
        ? [
            "--disable-blink-features=AutomationControlled",
            "--disable-features=site-per-process",
            "-disable-site-isolation-trials",
          ]
        : [...chromium.args, "--disable-blink-features=AutomationControlled"],
      defaultViewport: { width: width, height: height },
      executablePath: isDev
        ? localExecutablePath
        : await chromium.executablePath(remoteExecutablePath),
      headless: isDev ? false : "new",
      debuggingPort: isDev ? 9222 : undefined,
    });

    const pages = await browser.pages();
    const page = pages[0];
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: width, height: height });
    const preloadFile = fs.readFileSync(
      path.join(process.cwd(), "/src/utils/preload.js"),
      "utf8"
    );
    await page.evaluateOnNewDocument(preloadFile);
    await page.goto(urlStr, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await cfCheck(page);

    console.log("page title", await page.title());
    const blob = await page.screenshot({ type: "png" });

    const headers = new Headers();

    headers.set("Content-Type", "image/png");
    headers.set("Content-Length", blob.length.toString());
    // 添加缓存控制头
    headers.set("Cache-Control", "public, max-age=604800"); // 7天的缓存时间
    headers.set("ETag", `"${Buffer.from(blob).toString('base64').substring(0, 16)}"`);
    headers.set("Last-Modified", new Date().toUTCString());

    // or just use new Response ❗️
    return new NextResponse(blob, { status: 200, statusText: "OK", headers });
  } catch (err) {
    console.log(err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  } finally {
    await browser.close();
  }
}

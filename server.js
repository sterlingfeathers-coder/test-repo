const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { URL } = require('node:url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const defaultHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, defaultHeaders);
  res.end(JSON.stringify(payload));
}

function normalizeUrl(input) {
  if (!input) return null;
  try {
    const trimmed = input.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      return new URL(`https://${trimmed}`).href;
    }
    return new URL(trimmed).href;
  } catch {
    return null;
  }
}

function parseHtmlMetadata(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const descriptionMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
  );
  const viewportMatch = html.match(
    /<meta[^>]+name=["']viewport["'][^>]+content=["']([^"']*)["'][^>]*>/i,
  );

  return {
    title: titleMatch ? titleMatch[1].trim() : '',
    description: descriptionMatch ? descriptionMatch[1].trim() : '',
    viewport: viewportMatch ? viewportMatch[1].trim() : '',
  };
}

function countImagesMissingAlt(html) {
  const images = html.match(/<img\b[^>]*>/gi) || [];
  return images.reduce((acc, tag) => {
    const hasAlt = /alt\s*=\s*["'][^"']*["']/i.test(tag);
    return hasAlt ? acc : acc + 1;
  }, 0);
}

function extractLinks(html, baseUrl) {
  const matches = [...html.matchAll(/<a\s[^>]*href=["']?([^"'>\s#]+)[^>]*>/gi)];
  const base = new URL(baseUrl);
  const links = new Set();

  matches.forEach((match) => {
    const href = match[1];
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
    try {
      const resolved = new URL(href, base).href;
      if (resolved.startsWith('http')) {
        links.add(resolved);
      }
    } catch {
      // Ignore malformed URLs
    }
  });

  return Array.from(links);
}

async function checkLinkStatus(url, signal) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal,
      headers: { 'User-Agent': 'Site-Analyzer/1.0' },
    });
    if (response.ok) {
      return { url, ok: true, status: response.status };
    }
    // Fallback to GET for sites that do not handle HEAD
    const fallback = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal,
      headers: { 'User-Agent': 'Site-Analyzer/1.0' },
    });
    return { url, ok: fallback.ok, status: fallback.status };
  } catch (error) {
    return { url, ok: false, status: 0, error: error.message };
  }
}

async function analyzeWebsite(targetUrl) {
  const normalized = normalizeUrl(targetUrl);
  if (!normalized) {
    throw new Error('Please enter a valid URL.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  const started = performance.now();
  let response;
  try {
    response = await fetch(normalized, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Site-Analyzer/1.0' },
    });
  } catch (error) {
    throw new Error(`Unable to reach ${normalized}: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const loadTimeMs = Math.round(performance.now() - started);
  const html = await response.text();
  const { title, description, viewport } = parseHtmlMetadata(html);
  const missingAltImages = countImagesMissingAlt(html);
  const links = extractLinks(html, normalized);
  const maxLinksToCheck = 8;
  const sampledLinks = links.slice(0, maxLinksToCheck);
  const linkChecks = [];

  for (const link of sampledLinks) {
    const linkController = new AbortController();
    const timer = setTimeout(() => linkController.abort(), 8000);
    linkChecks.push(
      checkLinkStatus(link, linkController.signal).finally(() => clearTimeout(timer)),
    );
  }

  const checkedLinks = await Promise.all(linkChecks);
  const brokenLinks = checkedLinks.filter((link) => !link.ok);
  const sizeFromHeader = response.headers.get('content-length');
  const contentLength = sizeFromHeader ? Number(sizeFromHeader) : html.length;

  const suggestions = [];
  if (!title) suggestions.push('Add a descriptive <title> to improve SEO and clarity.');
  if (!description)
    suggestions.push('Include a meta description to control how your page appears in search results.');
  if (!viewport)
    suggestions.push('Add a responsive viewport meta tag for better mobile rendering.');
  if (missingAltImages > 0)
    suggestions.push('Provide alt text for images to improve accessibility.');
  if (brokenLinks.length > 0)
    suggestions.push('Resolve broken links to improve user experience and crawlability.');
  if (loadTimeMs > 3000)
    suggestions.push('Page took longer than 3s to respond; consider optimizing server response and assets.');
  if (contentLength > 800000)
    suggestions.push('Response is large; consider compressing assets or removing unused content.');
  if (!normalized.startsWith('https://'))
    suggestions.push('Serve the site over HTTPS to improve security and trust.');

  return {
    url: normalized,
    status: response.status,
    statusText: response.statusText,
    loadTimeMs,
    contentLength,
    metadata: { title, description, viewport },
    accessibility: { missingAltImages },
    links: {
      total: links.length,
      checked: sampledLinks.length,
      broken: brokenLinks.length,
      details: checkedLinks,
    },
    suggestions,
  };
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const resolved = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    const contentType =
      {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.svg': 'image/svg+xml',
      }[ext] || 'text/plain; charset=utf-8';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...defaultHeaders,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/scan') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 2_000_000) {
        req.socket.destroy();
      }
    });
    req.on('end', async () => {
      try {
        const { url } = JSON.parse(body || '{}');
        const analysis = await analyzeWebsite(url);
        sendJson(res, 200, { ok: true, data: analysis });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error';
        sendJson(res, 400, { ok: false, error: message });
      }
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

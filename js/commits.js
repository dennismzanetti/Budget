/**
 * commits.js — Fetches and renders the last 10 non-bot commits
 * from the Budget GitHub repo into the settings page table.
 */

const REPO = "dennismzanetti/Budget";
const API_URL = `https://api.github.com/repos/${REPO}/commits?per_page=30`;
const BOT_LOGINS = ["web-flow", "github-actions[bot]", "dependabot[bot]"];

/**
 * Returns true if a commit should be excluded (bot commit).
 */
function isBot(commit) {
  const committerLogin = commit.committer?.login ?? "";
  const committerName  = commit.commit?.committer?.name ?? "";
  const authorLogin    = commit.author?.login ?? "";
  return (
    BOT_LOGINS.includes(committerLogin) ||
    BOT_LOGINS.includes(authorLogin) ||
    committerName === "GitHub" ||
    committerLogin.includes("bot") ||
    authorLogin.includes("bot")
  );
}

/** Formats an ISO date string to a readable local date/time. */
function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year:   "numeric",
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit"
  });
}

/** Renders skeleton loading rows. */
function renderSkeleton(tbody) {
  tbody.innerHTML = Array.from({ length: 5 }, () => `
    <tr>
      <td><span class="skeleton" style="width:1.5rem"></span></td>
      <td><span class="skeleton" style="width:14rem"></span></td>
      <td><span class="skeleton" style="width:8rem"></span></td>
      <td><span class="skeleton" style="width:9rem"></span></td>
      <td><span class="skeleton" style="width:5rem"></span></td>
    </tr>
  `).join("");
}

/** Renders commit rows into the table body. */
function renderCommits(tbody, commits) {
  if (commits.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="commits-empty">No commits found.</td></tr>`;
    return;
  }
  tbody.innerHTML = commits.map((c, i) => {
    const msg    = c.commit.message.split("\n")[0];
    const author = c.commit.author.name;
    const date   = formatDate(c.commit.author.date);
    const sha    = c.sha;
    const shortSha = sha.slice(0, 7);
    const url    = c.html_url;
    return `
      <tr>
        <td class="commit-num">${i + 1}</td>
        <td class="commit-msg" title="${msg.replace(/"/g, '&quot;')}">${msg}</td>
        <td class="commit-author">${author}</td>
        <td class="commit-date">${date}</td>
        <td class="commit-sha">
          <a href="${url}" target="_blank" rel="noopener noreferrer" class="sha-link" title="${sha}">${shortSha}</a>
        </td>
      </tr>
    `;
  }).join("");
}

/** Renders an error row. */
function renderError(tbody, message) {
  tbody.innerHTML = `<tr><td colspan="5" class="commits-error">${message}</td></tr>`;
}

/**
 * Main entry point. Fetches commits and populates #commitsTbody.
 * Safe to call multiple times — skips if already loaded.
 */
export async function loadCommits() {
  const tbody = document.getElementById("commitsTbody");
  if (!tbody) return;
  if (tbody.dataset.loaded === "true") return;

  renderSkeleton(tbody);

  try {
    const res = await fetch(API_URL, {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const all     = await res.json();
    const commits = all.filter(c => !isBot(c)).slice(0, 10);

    renderCommits(tbody, commits);
    tbody.dataset.loaded = "true";
  } catch (err) {
    console.error("Failed to load commits:", err);
    renderError(tbody, "Unable to load commit history. Check your connection and try again.");
  }
}

#!/usr/bin/env node

const DEFAULT_BRANCH = 'main';
const DEFAULT_REQUIRED_CHECK = 'Web, Firebase, and Functions';

function usage() {
  return [
    'Usage:',
    '  GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo npm run github:protect-main',
    '  GITHUB_TOKEN=... npm run github:protect-main -- owner/repo [branch]',
    '',
    'Requires a token with repository administration permission.',
  ].join('\n');
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.\n\n${usage()}`);
  }
  return value;
}

function parseRepo(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Repository must be in owner/name form. Received: ${value}`);
  }
  return value;
}

const token = requiredEnv('GITHUB_TOKEN');
const repository = parseRepo(process.argv[2] ?? process.env.GITHUB_REPOSITORY ?? '');
const branch = process.argv[3] ?? process.env.GITHUB_BRANCH ?? DEFAULT_BRANCH;
const requiredCheck = process.env.GITHUB_REQUIRED_STATUS_CHECK ?? DEFAULT_REQUIRED_CHECK;

const body = {
  required_status_checks: {
    strict: true,
    contexts: [requiredCheck],
  },
  enforce_admins: true,
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: 1,
    require_last_push_approval: true,
  },
  restrictions: null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: true,
};

const url = `https://api.github.com/repos/${repository}/branches/${encodeURIComponent(branch)}/protection`;
const response = await fetch(url, {
  method: 'PUT',
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  },
  body: JSON.stringify(body),
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(`GitHub branch protection update failed (${response.status}): ${text}`);
}

console.log(`Protected ${repository}@${branch}. Required status check: ${requiredCheck}`);

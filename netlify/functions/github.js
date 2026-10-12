// Public-safe GitHub summary: contribution calendar + most recently pushed repo.
// Needs GITHUB_TOKEN (fine-grained PAT) in the environment.
const USERNAME = "elio1222";

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { date contributionCount contributionLevel }
        }
      }
    }
    repositories(first: 1, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        name
        description
        url
        pushedAt
        primaryLanguage { name color }
        stargazerCount
        defaultBranchRef {
          target {
            ... on Commit {
              history(first: 1) {
                nodes { messageHeadline url committedDate abbreviatedOid }
              }
            }
          }
        }
      }
    }
  }
}`;

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

exports.handler = async () => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return json(500, { error: "GITHUB_TOKEN is not set" }, 0);

  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "portfolio-github-function",
      },
      body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
    });
    const body = await res.json();
    if (!res.ok || body.errors) {
      console.error("GitHub error", res.status, JSON.stringify(body.errors || body));
      return json(502, { error: "GitHub request failed" }, 0);
    }

    const user = body.data.user;
    const cal = user.contributionsCollection.contributionCalendar;
    const repo = user.repositories.nodes[0] || null;

    return json(
      200,
      {
        username: USERNAME,
        total: cal.totalContributions,
        weeks: cal.weeks.map((w) =>
          w.contributionDays.map((d) => ({
            date: d.date,
            count: d.contributionCount,
            level: LEVELS[d.contributionLevel] ?? 0,
          }))
        ),
        repo: repo && {
          name: repo.name,
          description: repo.description,
          url: repo.url,
          pushedAt: repo.pushedAt,
          language: repo.primaryLanguage,
          stars: repo.stargazerCount,
          commit: repo.defaultBranchRef?.target?.history?.nodes?.[0] || null,
        },
      },
      1800
    );
  } catch (err) {
    console.error(err);
    return json(502, { error: "GitHub request failed" }, 0);
  }
};

function json(statusCode, data, maxAge) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}, stale-while-revalidate=3600` : "no-store",
    },
    body: JSON.stringify(data),
  };
}

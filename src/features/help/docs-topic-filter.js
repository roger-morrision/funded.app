// Search only existing topic titles and group labels; article bodies stay untouched.
export function filterDocumentationTopics(groups, query = '') {
  const literal = String(query).trim().toLowerCase();
  return groups.flatMap(group => group.items.filter(topic => !literal
    || topic.title.toLowerCase().includes(literal)
    || group.group.toLowerCase().includes(literal)));
}

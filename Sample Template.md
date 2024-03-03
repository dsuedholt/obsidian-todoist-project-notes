---
creation_date: <% tp.date.now("yyyy-MM-DD HH:mm") %>
---

<%* 

var projId = tp.frontmatter["todoist-project-id"];
var projInfo = app.plugins.plugins['obsidian-todoist-project-notes'].projectInfo;

var name = projInfo.projects.get(projId).name;
var children = projInfo.children.get(projId);
var notes = projInfo.notePaths;

// code block for todoist sync plugin
tR += `\`\`\`todoist
name: All tasks in ${name}
filter: "##${name}"
group: true
sort: order
show:
    - due
    - description
\`\`\`\n`;

// List of links to all subprojects
if (children) {
	tR += '## Subprojects:\n\n';
	children.forEach((child) => {
	var subProjName = projInfo.projects.get(child).name;
		tR += `- [[${notes.get(child)}|${subProjName}]]\n`;
	});
}
%>


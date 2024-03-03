# Todoist Project Notes for Obsidian

Automatically create notes for nested projects in Todoist. For use with [Todoist Sync](https://github.com/jamiebrynes7/obsidian-todoist-plugin) and [Templater](https://github.com/SilentVoid13/Templater).

# Table of Contents

- [Setup](#setup)
- [Basic Usage](#basic-usage)
- [Templating](#templating)
- [Syncing with Todoist](#syncing-with-todoist)
- [Todos](#todos)

# Setup

### Installation

This plugin is not currently available through Obsidian's community plugins. You can install it manually by downloading `obsidian-todoist-project-notes.zip` from the latest Release and unpacking it in your `.obsidian/plugins` directory.

Alternatively, you can clone this repository into `.obsidian/plugins` and run `npm install && npm run dev.

Then, go to the "Community Plugins" tab in the Obsidian settings, click the reload icon next to "Installed Plugins". "Todoist Project Notes" should show up in the list now; make sure to enable it.

### Required Settings

Go to the plugin's settings and paste your Todoist API key, which you can find [here](https://app.todoist.com/app/settings/integrations/developer). You should also set the folder in which the project notes will be created.

### Other Plugins (optional but recommended)

I would recommend that you install the "Todoist Sync" and "Templater" plugins through the Obsidian Community Plugins interface, if you haven't already; they make this plugin a lot more useful. Check that "Trigger Templater on new file creation" is enabled.

# Basic Usage

Once you've set up your API key and your project notes folder, bring up the Command palette (Ctrl/Cmd + P by default) and run the "Update Todoist Project Notes" command. The plugin will then create a note for every project and subproject in your Todoist account. By default, they will be sorted into a nested folder structure mirroring your Todoist setup:

![[docs/nested.png]]

You can change the settings to generate a flat folder instead, where the projects structure is reflected in the file name:

![[docs/flat.png]]

# Templating

The real use of this plugin comes from combining it with Templater and Todoist Sync. You can specify a template file that will be inserted into every newly created Project Note. Information about the current and other projects can be accessed from within templates through the `app.plugins.plugins['obsidian-todoist-project-notes'].projectInfo` object. It is defined at the top of `src/main.ts`, where you can see its contents.

Using this information, you can build up custom Todoist Sync queries or build up the file structure of the project note however you'd like. Check `Sample Template.md` to get started.

# Syncing with Todoist

### Dealing with renamed or moved projects

Every project note saves its unique Todoist project ID in its front matter. This allows for some basic housekeeping when you rename or rearrange your Todoist projects and run the plugin's "update" command again. Rather than recreating the file and making you lose all your notes, the plugin will recognize that a corresponding project file already exists and simply move it.

This is somewhat limited though. Links between files will not be automatically updated, which becomes especially clear if you switch between nested and flat structure. I recommend that you try out which structure you like and commit to one before putting the project notes to serious use.

You can choose in the settings how you'd like the plugin to handle notes belonging to projects that you deleted from your Todoist.
- Ignore: simply leave the project notes be and don't update them anymore.
- Archive: Move them to a user-defined archive folder.
- Delete: well, delete.

### Inserting project notes links into Tasks

You can choose to have the plugin automatically edit every Todoist Task's description with a link to its corresponding project note. If you show the description in your Todoist Sync query, it will then show up like this:
![[docs/notes in tasks.png]]

# Todos

This plugin is very much a work in progress. Here is a vague list of things I'd like to improve at some point. Feel free to suggest additions or open issues / PRs.
- [ ] automatically update links in other project notes and tasks on rename
- [ ] adding some form of support for sections
- [ ] check for empty folders and delete them
- [ ] support choosing different templates based on some conditions.



# Blog

A single-author publication whose content is prepared locally and released through Git.

## Language

**Author**:
The sole person who writes, edits, and publishes the blog's content.
_Avoid_: User, admin, editor

**Local CMS**:
The Author's development-only workspace for managing Posts, Site Settings, and previewing the Blog.
_Avoid_: Admin panel, production CMS, block editor

**Site Settings**:
Author-controlled identity, navigation, discovery, and sharing preferences that apply across the Blog.
_Avoid_: Build configuration, theme code, Post metadata

**Post**:
A publishable article consisting primarily of prose, images, links, and code examples.
_Avoid_: Page, entry, document

**Post Description**:
A short Author-approved summary of a Post used when the full body is inappropriate.
_Avoid_: First paragraph, excerpt, subtitle

**Draft**:
A Post not available to readers, regardless of whether its changes have been saved or committed.
_Avoid_: Hidden post, unpublished file

**Ready Post**:
A Post approved for inclusion in the next publication but not necessarily available to readers yet.
_Avoid_: Published Post, finished draft

**Published Post**:
A Post available to readers in the Published Site.
_Avoid_: Live draft, public entry

**Unreleased Change**:
A reader-visible change to a Published Post that is not yet available in the Published Site.
_Avoid_: Draft, update

**Publication Date**:
The date a Post first became a Published Post, independent of later revisions.
_Avoid_: File date, creation date

**Updated Date**:
The date of the latest reader-visible change to a Published Post; absent until such a change occurs.
_Avoid_: Build date, commit date, file modification time

**Tag**:
An optional, flat label connecting Posts about a shared subject.
_Avoid_: Category, folder, taxonomy

**Page**:
Standalone, undated content outside the chronological collection of Posts.
_Avoid_: Post, article, entry

**Post Index**:
A reverse-chronological list of Published Posts identified by Publication Date and title.
_Avoid_: Feed, gallery, card grid

**RSS Feed**:
A machine-readable, reverse-chronological subscription view of Published Posts.
_Avoid_: Newsletter, Post Index

**Published Site**:
The public, reader-facing form of the Blog.
_Avoid_: Production CMS, live editor

**Slug**:
The stable, human-readable identifier forming a Post's URL; it may contain a date when the Author chooses.
_Avoid_: Filename, title, database ID

**Post Image**:
An image belonging to and published with a Post.
_Avoid_: Upload, media record, attachment

**Social Image**:
A Post Image selected to represent a Post when shared outside the Blog, or the site-wide fallback when none is selected.
_Avoid_: Cover image, generated card, thumbnail

**Custom Content**:
Trusted, Author-controlled Post material outside the standard set of prose, images, links, and code examples.
_Avoid_: Plugin content, rich block

"use strict";

import { escapeXml } from "../common.js";
import Renderer from "./renderer.js";

var reUnsafeProtocol = /^javascript:|vbscript:|file:|data:/i;
var reSafeDataProtocol = /^data:image\/(?:png|gif|jpeg|webp)/i;

var potentiallyUnsafe = function(url) {
    return reUnsafeProtocol.test(url) && !reSafeDataProtocol.test(url);
};

function format_styles(stylesObject)
{
    let styles = "";
    for (let k of Object.keys(stylesObject))
    {
        styles += `${k}:${stylesObject[k]};`
    }
    if (styles.length > 0)
        return [ [ "style", styles ] ];
    else
        return [];
}

function parse_section_args(args)
{
    let result = {};

    let rxArgs = /(?:\.([-_a-zA-Z0-9]+))|(?:([-_a-zA-Z0-9]+)\:\s*([^;]*);?)|(?:#([-_a-zA-Z0-9]+))/g
    let t;
    while (t = rxArgs.exec(args))    
    {
        if (t[1])
        {
            if (!result.classes)
                result.classes = [];
            result.classes.push(t[1]);
        }
        else if (t[2])
        {
            if (!result.styles)
                result.styles = {};
            result.styles[t[2]] = t[3];
        }
        else if (t[4])
        {
            result.id = t[4];
        }
    }

    return result;
}

// Helper function to produce an HTML tag.
function tag(name, attrs, selfclosing) {
    if (this.disableTags > 0) {
        return;
    }
    this.buffer += "<" + name;
    if (attrs && attrs.length > 0) {
        var i = 0;
        var attrib;
        while ((attrib = attrs[i]) !== undefined) {
            this.buffer += " " + attrib[0] + '="' + attrib[1] + '"';
            i++;
        }
    }
    if (selfclosing) {
        this.buffer += " /";
    }
    this.buffer += ">";
    this.lastOut = ">";
}

function HtmlRenderer(options) {
    options = options || {};
    // by default, soft breaks are rendered as newlines in HTML
    options.softbreak = options.softbreak || "\n";
    // set to "<br />" to make them hard breaks
    // set to " " if you want to ignore line wrapping in source
    this.esc = options.esc || escapeXml;
    // escape html with a custom function
    // else use escapeXml

    this.disableTags = 0;
    this.lastOut = "\n";
    this.options = options;
    this.styles = {};
    this.scopes = [];
}

/* Node methods */

function document(node)
{
    this.styles = {};
    this.scopes = [];
}

function text(node) {
    this.out(node.literal);
}

function softbreak() {
    this.lit(this.options.softbreak);
}

function linebreak() {
    this.tag("br", [], true);
    this.cr();
}

function link(node, entering) {
    var attrs = this.attrs(node);
    if (entering) {
        if (!(this.options.safe && potentiallyUnsafe(node.destination))) {
            attrs.push(["href", this.esc(node.destination)]);
        }
        if (node.title) {
            attrs.push(["title", this.esc(node.title)]);
        }
        this.tag("a", attrs);
    } else {
        this.tag("/a");
    }
}

function image(node, entering) {
    if (entering) {
        if (this.disableTags === 0) {
            if (this.options.safe && potentiallyUnsafe(node.destination)) {
                this.lit('<img src="" alt="');
            } else {
                this.lit('<img src="' + this.esc(node.destination) + '" alt="');
            }
        }
        this.disableTags += 1;
    } else {
        this.disableTags -= 1;
        if (this.disableTags === 0) {
            if (node.title) {
                this.lit('" title="' + this.esc(node.title));
            }
            this.lit('" />');
        }
    }
}

function emph(node, entering) {
    this.tag(entering ? "em" : "/em");
}

function strong(node, entering) {
    this.tag(entering ? "strong" : "/strong");
}

function paragraph(node, entering) {
    var grandparent = node.parent.parent,
        attrs = this.attrs(node);
    if (grandparent !== null && grandparent.type === "list") {
        if (grandparent.listTight) {
            return;
        }
    }
    if (entering) {
        this.cr();
        this.tag("p", attrs);
    } else {
        this.tag("/p");
        this.cr();
    }
}

function heading(node, entering) {
    var tagname = "h" + node.level,
        attrs = this.attrs(node);
    if (entering) {
        this.cr();
        this.tag(tagname, attrs);
    } else {
        this.tag("/" + tagname);
        this.cr();
    }
}

function directive(node, entering) {
    switch (node.directive)
    {
        case 'color':
        case 'background-color':
        case 'font-size':
        case 'font-family':
            this.styles[node.directive] = node.args;
            return;

        case 'reset':
            this.styles = {};
            break;

        case 'push':
            this.scopes.unshift({
                kind: "push",
                styles: Object.assign({}, this.styles)
            });
            break;

        case 'pop':
            if (this.scopes[0]?.kind == "push")
            {
                this.styles = this.scopes.shift().styles;
            }
            else
            {
                this.tag("div", [ [ "class", "error" ] ]);
                this.out("error: unbalanced <code>!pop</code> directive");
                this.tag("/div");
            }
            break;

        case 'section':
            this.scopes.unshift({
                kind: "section",
                styles: Object.assign({}, this.styles),
            });
            let section_args = parse_section_args(node.args);
            let styles = Object.assign({}, this.styles, section_args.styles);
            this.cr();
            this.tag("div", [
                ...(section_args.classes ? [ [ "class", section_args.classes.join(" ") ] ] : []),
                ...(section_args.id ? [ [ "id", section_args.id ] ] : []),
                ...format_styles(styles)
            ]);
            this.styles = {};
            break;

        case 'end':
            // Discard any any unpopped push directives
            while (this.scopes[0]?.kind == "push")
                this.scopes.shift();

            if (this.scopes[0]?.kind == "section")
            {
                this.tag("/div");
                this.styles = this.scopes.shift().styles;
            }
            else
            {
                this.tag("div", [ [ "class", "error" ] ]);
                this.out("error: unbalanced <code>!end</code> directive");
                this.tag("/div");
            }
            break;
    }
}

function code(node) {
    this.tag("code");
    this.out(node.literal);
    this.tag("/code");
}

function code_block(node) {
    var info_words = node.info ? node.info.split(/\s+/) : [],
        attrs = this.attrs(node);
    if (info_words.length > 0 && info_words[0].length > 0) {
        var cls = this.esc(info_words[0]);
        if (!/^language-/.exec(cls)) {
          cls = "language-" + cls;
        }
        attrs.push(["class", cls]);
    }
    this.cr();
    this.tag("pre");
    this.tag("code", attrs);
    this.out(node.literal);
    this.tag("/code");
    this.tag("/pre");
    this.cr();
}

function thematic_break(node) {
    var attrs = this.attrs(node);
    this.cr();
    this.tag("hr", attrs, true);
    this.cr();
}

function block_quote(node, entering) {
    var attrs = this.attrs(node);
    if (entering) {
        this.scopes.unshift({
            kind: "block_quote",
            styles: Object.assign({}, this.styles)
        });
        this.styles = {};
        this.cr();
        this.tag("blockquote", attrs);
        this.cr();
    } else {
        while (this.scopes[0]?.kind != "block_quote")
            this.scopes.shift();
        this.styles = this.scopes.shift().styles;
        this.cr();
        this.tag("/blockquote");
        this.cr();
    }
}

function list(node, entering) {
    var tagname = node.listType === "bullet" ? "ul" : "ol",
        attrs = this.attrs(node);

    if (entering) {
        var start = node.listStart;
        if (start !== null && start !== 1) {
            attrs.push(["start", start.toString()]);
        }
        this.cr();
        this.tag(tagname, attrs);
        this.cr();
    } else {
        this.cr();
        this.tag("/" + tagname);
        this.cr();
    }
}

function item(node, entering) {
    var attrs = this.attrs(node);
    if (entering) {
        this.tag("li", attrs);
    } else {
        this.tag("/li");
        this.cr();
    }
}

function html_inline(node) {
    if (this.options.safe) {
        this.lit("<!-- raw HTML omitted -->");
    } else {
        this.lit(node.literal);
    }
}

function html_block(node) {
    this.cr();
    if (this.options.safe) {
        this.lit("<!-- raw HTML omitted -->");
    } else {
        this.lit(node.literal);
    }
    this.cr();
}

function custom_inline(node, entering) {
    if (entering && node.onEnter) {
        this.lit(node.onEnter);
    } else if (!entering && node.onExit) {
        this.lit(node.onExit);
    }
}

function custom_block(node, entering) {
    this.cr();
    if (entering && node.onEnter) {
        this.lit(node.onEnter);
    } else if (!entering && node.onExit) {
        this.lit(node.onExit);
    }
    this.cr();
}

/* Helper methods */

function out(s) {
    this.lit(this.esc(s));
}

function attrs(node) {
    var att = [];
    if (this.options.sourcepos) {
        var pos = node.sourcepos;
        if (pos) {
            att.push([
                "data-sourcepos",
                String(pos[0][0]) +
                    ":" +
                    String(pos[0][1]) +
                    "-" +
                    String(pos[1][0]) +
                    ":" +
                    String(pos[1][1])
            ]);
        }
    }
    if (node.type == 'paragraph' || 
        node.type == 'code_block' || 
        node.type == 'block_quote' ||
        node.type == 'list' || 
        node.type == 'heading'
        )
    {
        att.push(...format_styles(this.styles));
    }
    return att;
}

// quick browser-compatible inheritance
HtmlRenderer.prototype = Object.create(Renderer.prototype);

HtmlRenderer.prototype.document = document;
HtmlRenderer.prototype.text = text;
HtmlRenderer.prototype.html_inline = html_inline;
HtmlRenderer.prototype.html_block = html_block;
HtmlRenderer.prototype.softbreak = softbreak;
HtmlRenderer.prototype.linebreak = linebreak;
HtmlRenderer.prototype.link = link;
HtmlRenderer.prototype.image = image;
HtmlRenderer.prototype.emph = emph;
HtmlRenderer.prototype.strong = strong;
HtmlRenderer.prototype.paragraph = paragraph;
HtmlRenderer.prototype.heading = heading;
HtmlRenderer.prototype.directive = directive;
HtmlRenderer.prototype.code = code;
HtmlRenderer.prototype.code_block = code_block;
HtmlRenderer.prototype.thematic_break = thematic_break;
HtmlRenderer.prototype.block_quote = block_quote;
HtmlRenderer.prototype.list = list;
HtmlRenderer.prototype.item = item;
HtmlRenderer.prototype.custom_inline = custom_inline;
HtmlRenderer.prototype.custom_block = custom_block;

HtmlRenderer.prototype.esc = escapeXml;

HtmlRenderer.prototype.out = out;
HtmlRenderer.prototype.tag = tag;
HtmlRenderer.prototype.attrs = attrs;

export default HtmlRenderer;

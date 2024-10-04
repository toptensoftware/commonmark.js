import { test } from 'node:test';
import  assert from 'node:assert';
import { Parser, HtmlRenderer }  from '../lib/index.js'


let parser = new Parser();
let renderer = new HtmlRenderer({sourcepos: true});

test("basic", t => {
    let parsed = parser.parse("\n!color red\nThis is a paragraph\n");
    let rendered = renderer.render(parsed);
    console.log(rendered);
});
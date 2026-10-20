import { afterEach, describe, expect, it } from "vitest";
import { isTypingOrDialogTarget } from "../keyboardTargets";

const mount = (html: string) => {
  document.body.innerHTML = html;
  return (selector: string) => document.querySelector(selector);
};

afterEach(() => { document.body.innerHTML = ""; });

describe("isTypingOrDialogTarget", () => {
  it("leaves keys typed into fields to the field", () => {
    const find = mount(`
      <input id="input" /><textarea id="textarea"></textarea><select id="select"><option>1</option></select>
      <div contenteditable="true"><span id="editable">note</span></div>
      <div id="plain-editable" contenteditable=""></div>
      <div id="textbox" role="textbox" aria-readonly="true">https://community.tagify.fm/join/alex</div>`);
    for (const id of ["#input", "#textarea", "#select", "#editable", "#plain-editable", "#textbox"]) {
      expect(isTypingOrDialogTarget(find(id)), id).toBe(true);
    }
  });

  it("leaves keys pressed inside a dialog or popover to it", () => {
    const find = mount(`
      <div role="dialog" aria-labelledby="tagify-invite-title"><button id="copy">Copy link</button></div>
      <div role="alertdialog"><button id="confirm">Delete</button></div>
      <dialog open><button id="native">Remove rating</button></dialog>`);
    for (const id of ["#copy", "#confirm", "#native"]) {
      expect(isTypingOrDialogTarget(find(id)), id).toBe(true);
    }
  });

  it("lets shortcuts through from the page itself", () => {
    const find = mount(`
      <main><button id="tag">Chill</button><div contenteditable="false"><span id="locked">x</span></div></main>`);
    expect(isTypingOrDialogTarget(find("#tag"))).toBe(false);
    expect(isTypingOrDialogTarget(find("#locked"))).toBe(false);
    expect(isTypingOrDialogTarget(document.body)).toBe(false);
    expect(isTypingOrDialogTarget(document)).toBe(false);
    expect(isTypingOrDialogTarget(window)).toBe(false);
    expect(isTypingOrDialogTarget(null)).toBe(false);
  });
});

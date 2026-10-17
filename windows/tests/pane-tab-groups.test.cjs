const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PaneTabGroups,replaceTreePanel} = require('../renderer/pane-tab-groups.js');
function storage(initial='[]') {
  const values=new Map([['cmux.paneTabGroups',initial]]);
  return {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
}
const workspace = activePanelId=>({id:'w',activePanelId,panels:['a','b','c'].map(id=>({id}))});
test('moving an inactive tab to another workspace retains source selection and split ratios',()=>{
  const tabs=new PaneTabGroups(storage());tabs.add('w','a','c');tabs.visiblePanels(workspace('a'));
  const tree={type:'split',id:'s',ratio:.3,direction:'right',first:{type:'pane',panelId:'a'},second:{type:'pane',panelId:'b'}};
  const destination={id:'other',activePanelId:'d',panels:[{id:'d'}]};
  const result=tabs.moveToWorkspace(tree,{type:'pane',panelId:'d'},workspace('a'),destination,'c');
  assert.deepEqual(result.panelIds,['c']);assert.deepEqual(result.sourceTree,tree);
  assert.equal(result.targetTree.second.panelId,'c');
  assert.deepEqual(tabs.groupFor('a').members,['a']);
  assert.equal(tabs.groupFor('c'),undefined);
});
test('moving a group across workspaces preserves its order, selection and saved ownership',()=>{
  const saved=storage(),tabs=new PaneTabGroups(saved);tabs.add('w','a','c');
  const result=tabs.moveToWorkspace({type:'pane',panelId:'c'},null,workspace('c'),{id:'other',panels:[]},'a',{wholeGroup:true});
  assert.deepEqual(result.panelIds,['a','c']);assert.equal(result.sourceTree,null);
  assert.deepEqual(result.targetTree,{type:'pane',panelId:'a'});
  const restored=new PaneTabGroups(saved);
  assert.equal(restored.groupFor('a').workspaceId,'other');
  assert.deepEqual(restored.groupFor('a').members,['a','c']);
  assert.equal(restored.groupFor('a').active,'a');
});
test('switching tabs replaces only its leaf and preserves split ratios',()=>{
  const tabs=new PaneTabGroups(storage());
  tabs.add('w','a','c');
  const tree={type:'split',id:'split1',ratio:.3,direction:'right',first:{type:'pane',panelId:'a'},second:{type:'pane',panelId:'b'}};
  assert.deepEqual(tabs.visiblePanels(workspace('c')).map(p=>p.id),['b','c']);
  assert.deepEqual(tabs.remapTree(tree),{...tree,first:{type:'pane',panelId:'c'}});
  tabs.visiblePanels(workspace('a'));
  assert.deepEqual(tabs.remapTree(tree),tree);
  assert.equal(tree.first.panelId,'a','source tree is immutable');
});
test('closing active tab selects a surviving process in the same split',()=>{
  const tabs=new PaneTabGroups(storage());
  tabs.add('w','a','c');
  assert.equal(tabs.replacementForRemoval('c'),'a');
  assert.deepEqual(tabs.members(workspace('a'),'a').map(p=>p.id),['a']);
});
test('closing inactive tab retains the selected terminal',()=>{
  const tabs=new PaneTabGroups(storage());
  tabs.add('w','a','c');
  assert.equal(tabs.replacementForRemoval('a'),'c');
  assert.equal(tabs.groupFor('c').active,'c');
});
test('restoring tab groups preserves membership and independent pane selection',()=>{
  const saved=storage();
  const tabs=new PaneTabGroups(saved);
  tabs.add('w','a','c');
  const restored=new PaneTabGroups(saved);
  assert.deepEqual(restored.visiblePanels(workspace('b')).map(p=>p.id),['b','c']);
  assert.deepEqual(restored.members(workspace('b'),'c').map(p=>p.id),['a','c']);
});
test('closed runtime panels are pruned and corrupt layout cannot prevent startup',()=>{
  const tabs=new PaneTabGroups(storage());
  tabs.add('w','a','c');
  tabs.visiblePanels({id:'w',activePanelId:'a',panels:[{id:'a'}]});
  assert.equal(tabs.groupFor('c'),undefined);
  assert.deepEqual(new PaneTabGroups(storage('{bad')).visiblePanels(workspace('a')).map(p=>p.id),['a','b','c']);
});
test('replacing a tab leaf preserves the adjacent split',()=>{
  const tree={type:'split',id:'s',ratio:.7,first:{type:'pane',panelId:'a'},second:{type:'pane',panelId:'b'}};
  assert.deepEqual(replaceTreePanel(tree,'a','c'),{...tree,first:{type:'pane',panelId:'c'}});
});
test('tab transfer preserves source process, target tabs and split ratio',()=>{
  const saved=storage(),tabs=new PaneTabGroups(saved);
  const tree={type:'split',id:'s',ratio:.3,direction:'right',first:{type:'pane',panelId:'c'},second:{type:'pane',panelId:'b'}};
  tabs.add('w','a','c');
  const moved=tabs.transfer(tree,workspace('c'),'c','b');
  assert.equal(moved.ratio,.3);
  assert.deepEqual(tabs.members(workspace('c'),'b').map(p=>p.id),['c','b']);
  assert.deepEqual(moved.first,{type:'pane',panelId:'a'});
  assert.deepEqual(moved.second,{type:'pane',panelId:'c'});
  assert.deepEqual(new PaneTabGroups(saved).members(workspace('c'),'c').map(p=>p.id),['c','b']);
});
test('detaching an inactive tab, merging whole groups and self drops retain every live panel',()=>{
  const tabs=new PaneTabGroups(storage());tabs.add('w','a','c');
  tabs.visiblePanels(workspace('a'));
  const tree={type:'split',id:'s',ratio:.7,direction:'right',first:{type:'pane',panelId:'a'},second:{type:'pane',panelId:'b'}};
  const detached=tabs.transfer(tree,workspace('a'),'c','b',{placement:'left'});
  assert.equal(detached.ratio,.7);assert.equal(tabs.groupFor('a').active,'a');
  assert.deepEqual(detached.second.first,{type:'pane',panelId:'c'});
  assert.deepEqual(tabs.transfer(detached,workspace('a'),'c','c',{placement:'left'}),detached);
  tabs.add('w','a','c');
  const merged=tabs.transfer(tabs.remapTree(tree),workspace('a'),'a','b',{wholeGroup:true});
  assert.deepEqual(merged,{type:'pane',panelId:'a'});
  assert.deepEqual(new Set(tabs.groupFor('b').members),new Set(['a','b','c']));
});

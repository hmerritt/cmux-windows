// Tab membership belongs to the desktop layout, alongside the existing split
// tree. Terminal processes remain owned by the runtime when their tab is hidden.
import {removePanelFromPaneTree,insertPanelAtLeaf} from './pane-tree.js';
export class PaneTabGroups {
  constructor(storage) {
    this.storage = storage;
    try {
      const saved = JSON.parse(storage.getItem('cmux.paneTabGroups') || '[]');
      this.groups = Array.isArray(saved) ? saved.filter(group => typeof group.workspaceId === 'string' && Array.isArray(group.members) && group.members.every(id => typeof id === 'string')) : [];
    } catch { this.groups = []; }
  }
  save() { this.storage.setItem('cmux.paneTabGroups', JSON.stringify(this.groups)); }
  groupFor(panelId) { return this.groups.find(group => group.members.includes(panelId)); }
  add(workspaceId, anchorId, panelId) {
    let group = this.groupFor(anchorId);
    if (!group) {
      group = {workspaceId, members:[anchorId], active:anchorId};
      this.groups.push(group);
    }
    if (!group.members.includes(panelId)) group.members.push(panelId);
    group.active = panelId;
    this.save();
  }
  visiblePanels(workspace) {
    if (!workspace) return [];
    let changed = false;
    const live = new Set(workspace.panels.map(panel => panel.id));
    for (const group of this.groups.filter(group => group.workspaceId === workspace.id)) {
      const members = group.members.filter(id => live.has(id));
      if (members.length !== group.members.length) { group.members = members; changed = true; }
      const active = members.includes(workspace.activePanelId) ? workspace.activePanelId : members.includes(group.active) ? group.active : members[0];
      if (group.active !== active) { group.active = active; changed = true; }
    }
    if (changed) {
      this.groups = this.groups.filter(group => group.members.length > 0);
      this.save();
    }
    return workspace.panels.filter(panel => {
      const group = this.groupFor(panel.id);
      return !group || group.active === panel.id;
    });
  }
  members(workspace, panelId) {
    const group = this.groupFor(panelId);
    return group ? group.members.map(id => workspace.panels.find(panel => panel.id === id)).filter(Boolean) : workspace.panels.filter(panel => panel.id === panelId);
  }
  replacementForRemoval(panelId) {
    const group = this.groupFor(panelId);
    if (!group) return null;
    group.members = group.members.filter(id => id !== panelId);
    if (group.active === panelId) group.active = group.members[0];
    this.groups = this.groups.filter(group => group.members.length > 0);
    this.save();
    return group.active || null;
  }
  reorder(panelId, targetId, after=false) {
    const group=this.groupFor(panelId);
    if(!group || group!==this.groupFor(targetId) || panelId===targetId)return false;
    group.members=group.members.filter(id=>id!==panelId);
    group.members.splice(group.members.indexOf(targetId)+(after?1:0),0,panelId);
    this.save();return true;
  }
  transfer(tree,workspace,sourceId,targetId,{placement='center',wholeGroup=false,after=false}={}) {
    const live=new Set(workspace.panels.map(panel=>panel.id));
    if(!live.has(sourceId) || !live.has(targetId))return tree;
    const source=this.groupFor(sourceId),destination=this.groupFor(targetId);
    if(sourceId===targetId && (!source || source.members.length===1))return tree;
    if(placement==='center' && (source===destination && source || sourceId===targetId)) {
      if(!wholeGroup)this.reorder(sourceId,targetId,after);
      return tree;
    }
    const moving=wholeGroup && source?[...source.members]:[sourceId];
    if(wholeGroup && moving.includes(targetId))return tree;
    const oldActive=source?.active || sourceId;
    if(wholeGroup) this.groups=this.groups.filter(group=>group!==source);
    else if(source) {
      source.members=source.members.filter(id=>id!==sourceId);
      if(source.active===sourceId)source.active=source.members[0];
      this.groups=this.groups.filter(group=>group.members.length);
    }
    const replacement=!wholeGroup?source?.active:null;
    if(moving.includes(oldActive))tree=replacement?replaceTreePanel(tree,oldActive,replacement):removePanelFromPaneTree(tree,oldActive);
    if(moving.includes(targetId))targetId=replacement;
    if(!targetId) { // A lone tab cannot split against itself.
      if(wholeGroup && source)this.groups.push(source);
      this.save();return tree;
    }
    if(placement==='center') {
      let group=this.groupFor(targetId);
      if(!group){group={workspaceId:workspace.id,members:[targetId],active:targetId};this.groups.push(group);}
      const at=group.members.indexOf(targetId)+(after?1:0);
      const targetActive=group.active;
      group.members.splice(at,0,...moving);
      group.active=sourceId;
      tree=replaceTreePanel(tree,targetActive,sourceId);
    } else {
      const targetActive=this.groupFor(targetId)?.active || targetId;
      if(moving.length>1)this.groups.push({workspaceId:workspace.id,members:moving,active:sourceId});
      tree=insertPanelAtLeaf(tree,targetActive,sourceId,['top','bottom'].includes(placement)?'down':'right',['left','top'].includes(placement)?'before':'after').node;
    }
    this.save();return tree;
  }
  remapTree(tree) {
    if (!tree) return tree;
    if (tree.type === 'pane') {
      const group = this.groupFor(tree.panelId);
      return group?.active ? {...tree, panelId:group.active} : tree;
    }
    return {...tree, first:this.remapTree(tree.first), second:this.remapTree(tree.second)};
  }
}

export function replaceTreePanel(tree, fromId, toId) {
  if (!tree) return tree;
  if (tree.type === 'pane') return tree.panelId === fromId ? {...tree, panelId:toId} : tree;
  return {...tree, first:replaceTreePanel(tree.first,fromId,toId), second:replaceTreePanel(tree.second,fromId,toId)};
}

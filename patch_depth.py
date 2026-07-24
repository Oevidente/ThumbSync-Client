import re

with open('app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update saveScrollState
old_save = """  saveScrollState() {
    this.savedScrolls = this.savedScrolls || {};"""
new_save = """  saveScrollState() {
    if ((this._renderDepth || 0) > 0) return;
    this.savedScrolls = this.savedScrolls || {};"""
content = content.replace(old_save, new_save, 1)
content = content.replace(old_save.replace('\n', '\r\n'), new_save.replace('\n', '\r\n'), 1)

# 2. Update restoreScrollState
old_restore = """  restoreScrollState() {
    if (!this.savedScrolls) return;"""
new_restore = """  restoreScrollState() {
    if ((this._renderDepth || 0) > 0) return;
    if (!this.savedScrolls) return;"""
content = content.replace(old_restore, new_restore, 1)
content = content.replace(old_restore.replace('\n', '\r\n'), new_restore.replace('\n', '\r\n'), 1)

# 3. Update render() start
old_render = """  render() {
    this.saveScrollState();
    const root = document.getElementById('root');"""
new_render = """  render() {
    this._renderDepth = (this._renderDepth || 0);
    this.saveScrollState();
    this._renderDepth++;
    const root = document.getElementById('root');"""
content = content.replace(old_render, new_render, 1)
content = content.replace(old_render.replace('\n', '\r\n'), new_render.replace('\n', '\r\n'), 1)

# 4. Update render() end
old_render_end = """    if (!this._assistantStarted) {
      this._assistantStarted = true;
      this.startAssistantMessages();
    }
    this.restoreScrollState();
  }"""
new_render_end = """    if (!this._assistantStarted) {
      this._assistantStarted = true;
      this.startAssistantMessages();
    }
    this._renderDepth--;
    this.restoreScrollState();
  }"""
content = content.replace(old_render_end, new_render_end, 1)
content = content.replace(old_render_end.replace('\n', '\r\n'), new_render_end.replace('\n', '\r\n'), 1)

# 5. Update renderActiveTab() start
old_active = """  renderActiveTab() {
    this.saveScrollState();
    const contentFrame = document.getElementById('tab-content');"""
new_active = """  renderActiveTab() {
    this._renderDepth = (this._renderDepth || 0);
    this.saveScrollState();
    this._renderDepth++;
    const contentFrame = document.getElementById('tab-content');"""
content = content.replace(old_active, new_active, 1)
content = content.replace(old_active.replace('\n', '\r\n'), new_active.replace('\n', '\r\n'), 1)

# 6. Update renderActiveTab() end
old_active_end = """    this.bindTabEvents();
    this.restoreScrollState();
  }"""
new_active_end = """    this.bindTabEvents();
    this._renderDepth--;
    this.restoreScrollState();
  }"""
content = content.replace(old_active_end, new_active_end, 1)
content = content.replace(old_active_end.replace('\n', '\r\n'), new_active_end.replace('\n', '\r\n'), 1)


with open('app.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Patched app.js with depth")

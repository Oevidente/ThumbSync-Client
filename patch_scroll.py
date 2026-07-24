import re

with open('app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Insert saveScrollState and restoreScrollState before render()
scroll_methods = """  saveScrollState() {
    this.savedScrolls = this.savedScrolls || {};
    const main = document.getElementById('main-scroll-container');
    if (main) {
      this.savedScrolls.mainScrollY = main.scrollTop;
      this.savedScrolls.mainScrollX = main.scrollLeft;
    }
    const horizontal = document.getElementById('mural-horizontal-scroll');
    if (horizontal) {
      this.savedScrolls.muralScrollX = horizontal.scrollLeft;
      this.savedScrolls.muralScrollY = horizontal.scrollTop;
    }
    this.savedScrolls.windowY = window.scrollY;
    this.savedScrolls.windowX = window.scrollX;
  }

  restoreScrollState() {
    if (!this.savedScrolls) return;
    requestAnimationFrame(() => {
      if (this.savedScrolls.windowY !== undefined) {
        window.scrollTo(this.savedScrolls.windowX || 0, this.savedScrolls.windowY || 0);
      }
      const main = document.getElementById('main-scroll-container');
      if (main && this.savedScrolls.mainScrollY !== undefined) {
        main.scrollTop = this.savedScrolls.mainScrollY;
        main.scrollLeft = this.savedScrolls.mainScrollX || 0;
      }
      const horizontal = document.getElementById('mural-horizontal-scroll');
      if (horizontal && this.savedScrolls.muralScrollX !== undefined) {
        horizontal.scrollLeft = this.savedScrolls.muralScrollX;
        horizontal.scrollTop = this.savedScrolls.muralScrollY || 0;
      }
    });
  }

  // --- HTML DRAW PIPELINE ---"""

content = content.replace('  // --- HTML DRAW PIPELINE ---', scroll_methods, 1)

# 2. Add saveScrollState at start of render()
content = content.replace('  render() {\n    const root = document.getElementById(\'root\');', '  render() {\n    this.saveScrollState();\n    const root = document.getElementById(\'root\');', 1)
content = content.replace('  render() {\r\n    const root = document.getElementById(\'root\');', '  render() {\r\n    this.saveScrollState();\r\n    const root = document.getElementById(\'root\');', 1)

# 3. Add restoreScrollState at end of render()
end_render = """    if (!this._assistantStarted) {
      this._assistantStarted = true;
      this.startAssistantMessages();
    }
  }"""
new_end_render = """    if (!this._assistantStarted) {
      this._assistantStarted = true;
      this.startAssistantMessages();
    }
    this.restoreScrollState();
  }"""
content = content.replace(end_render, new_end_render, 1)
end_render_cr = end_render.replace('\n', '\r\n')
new_end_render_cr = new_end_render.replace('\n', '\r\n')
content = content.replace(end_render_cr, new_end_render_cr, 1)

# 4. Add id to main-scroll-container
content = content.replace('<div class="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 md:p-8 pb-32 lg:pb-12 custom-scrollbar relative z-0 w-full">', '<div id="main-scroll-container" class="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 md:p-8 pb-32 lg:pb-12 custom-scrollbar relative z-0 w-full">', 1)

# 5. Add saveScrollState to renderActiveTab()
content = content.replace('  renderActiveTab() {\n    const contentFrame = document.getElementById(\'tab-content\');', '  renderActiveTab() {\n    this.saveScrollState();\n    const contentFrame = document.getElementById(\'tab-content\');', 1)
content = content.replace('  renderActiveTab() {\r\n    const contentFrame = document.getElementById(\'tab-content\');', '  renderActiveTab() {\r\n    this.saveScrollState();\r\n    const contentFrame = document.getElementById(\'tab-content\');', 1)

# 6. Add restoreScrollState to end of renderActiveTab()
end_active_tab = """    this.bindTabEvents();
  }"""
new_end_active_tab = """    this.bindTabEvents();
    this.restoreScrollState();
  }"""
content = content.replace(end_active_tab, new_end_active_tab, 1)
end_active_tab_cr = end_active_tab.replace('\n', '\r\n')
new_end_active_tab_cr = new_end_active_tab.replace('\n', '\r\n')
content = content.replace(end_active_tab_cr, new_end_active_tab_cr, 1)

# 7. Add id to mural-horizontal-scroll
content = content.replace('<div class="flex overflow-x-auto items-start gap-6 pb-6 custom-scrollbar snap-x">', '<div id="mural-horizontal-scroll" class="flex overflow-x-auto items-start gap-6 pb-6 custom-scrollbar snap-x">', 1)

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Patched app.js")

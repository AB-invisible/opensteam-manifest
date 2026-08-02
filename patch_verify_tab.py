import sys

file_path = 'b:/Backup/own-manifest/app/admin/page.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update activeTab type
type_old = "'organizations' | 'notifications' | 'donations' | 'chat' | 'applications' | 'punishments' | 'exe' | 'appeals' | 'tickets' | 'hosted-bots' | 'members-shop' | 'vouchers' | 'plan-upgrade'>('overview')"
type_new = "'organizations' | 'notifications' | 'donations' | 'chat' | 'applications' | 'punishments' | 'exe' | 'appeals' | 'tickets' | 'hosted-bots' | 'members-shop' | 'vouchers' | 'plan-upgrade' | 'verify'>('overview')"
content = content.replace(type_old, type_new)

# 2. Add verify button to sidebar
sidebar_old = """              {currentUserRole === 'OWNER' && (
                <button
                  onClick={() => { setActiveTab('settings'); loadConfigs(); }}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'settings' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <LayoutGrid className="h-5 w-5" />
                  <span>Settings</span>
                </button>
              )}"""
sidebar_new = """              {currentUserRole === 'OWNER' && (
                <>
                  <button
                    onClick={() => { setActiveTab('verify'); loadConfigs(); }}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'verify' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                  >
                    <UserCheck className="h-5 w-5" />
                    <span>Verification</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('settings'); loadConfigs(); }}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'settings' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                  >
                    <LayoutGrid className="h-5 w-5" />
                    <span>Settings</span>
                  </button>
                </>
              )}"""
content = content.replace(sidebar_old, sidebar_new)

# 3. Handle verify tab in navigateFromChart
nav_old = "if (tab === 'settings') void loadConfigs()"
nav_new = "if (tab === 'settings' || tab === 'verify') void loadConfigs()"
content = content.replace(nav_old, nav_new)

# 4. Handle in reloadTab (just add to if-else)
reload_old = "    } else if (tab === 'organizations') {"
reload_new = """    } else if (tab === 'verify') {
      loadConfigs()
    } else if (tab === 'organizations') {"""
content = content.replace(reload_old, reload_new)

# 5. Extract verification UI
start_str = '                        <div className="mt-4 p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl space-y-3">\n                          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Discord Verification</p>'

# Let us find the index of start_str
start_idx = content.find(start_str)

if start_idx != -1:
    # Find closing div
    open_divs = 0
    i = start_idx
    found_first = False
    
    while i < len(content):
        if content[i:i+4] == '<div':
            open_divs += 1
            found_first = True
            i += 4
            continue
        elif content[i:i+5] == '</div':
            open_divs -= 1
            if found_first and open_divs == 0:
                i += 6 # include >
                end_idx = i
                break
            i += 5
            continue
        i += 1
        
    extracted_html = content[start_idx:end_idx]
    
    # Remove from settings
    content = content[:start_idx] + content[end_idx:]
    
    # Inject into a new tab section
    new_tab = f"""
                      {{activeTab === 'verify' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                          <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-black uppercase tracking-wider text-white">Verification Center</h2>
                          </div>
                          {extracted_html}
                        </div>
                      )}}
"""
    
    # Insert right before settings block
    settings_start = "{activeTab === 'settings' && ("
    content = content.replace(settings_start, new_tab + settings_start)
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Extraction success')
else:
    print('Start string not found')

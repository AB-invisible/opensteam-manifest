import { useEffect, useState } from 'react'
import { Activity, Clock, ShieldAlert, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'

export default function GenerationsPanel() {
  const [generations, setGenerations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    fetchGenerations()
  }, [page])

  async function fetchGenerations() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/generations?page=${page}&limit=50`)
      const data = await res.json()
      if (data.generations) {
        setGenerations(data.generations)
        setTotalPages(data.pagination.totalPages)
      }
    } catch (e) {
      console.error('Failed to fetch generations', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 p-6 rounded-3xl">
        <div className="flex items-center space-x-3 mb-6">
          <Activity className="h-6 w-6 text-indigo-400" />
          <h2 className="text-xl font-black uppercase tracking-widest text-white">Generation Logs</h2>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <Activity className="h-8 w-8 animate-spin mx-auto text-indigo-500 mb-4" />
            <p className="text-muted-foreground uppercase tracking-widest text-sm font-bold">Loading Logs...</p>
          </div>
        ) : generations.length === 0 ? (
          <div className="text-center py-12 bg-white/5 rounded-2xl border border-white/5">
            <Activity className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground font-medium">No generations recorded.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-4">Game</th>
                    <th className="py-3 px-4">App ID</th>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {generations.map((gen) => (
                    <tr key={gen.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-4 px-4 font-bold text-white max-w-[200px] truncate" title={gen.gameName}>
                        {gen.gameName}
                      </td>
                      <td className="py-4 px-4">
                        <span className="bg-white/10 px-2 py-1 rounded text-xs font-mono">{gen.appId}</span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-white">{gen.user?.username || 'Unknown'}</span>
                          {gen.user?.plan !== 'FREE' && (
                            <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-black tracking-wider uppercase">
                              {gen.user?.plan}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {gen.isNsfw ? (
                          <div className="flex items-center space-x-1.5 text-rose-400">
                            <ShieldAlert className="h-4 w-4" />
                            <span className="text-xs font-bold uppercase tracking-wider">NSFW Blocked</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1.5 text-emerald-400">
                            <CheckCircle2 className="h-4 w-4" />
                            <span className="text-xs font-bold uppercase tracking-wider">Success</span>
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right text-sm text-muted-foreground flex items-center justify-end space-x-1">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{new Date(gen.createdAt).toLocaleString()}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="flex items-center justify-between mt-6 border-t border-white/10 pt-4">
              <span className="text-sm text-muted-foreground">
                Page <strong className="text-white">{page}</strong> of <strong className="text-white">{totalPages}</strong>
              </span>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-50 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-50 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

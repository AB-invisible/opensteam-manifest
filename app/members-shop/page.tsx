'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Activity } from 'lucide-react'
import MembersShopPanel from '@/app/admin/components/MembersShopPanel'
import { useToast } from '@/app/components/Toast'

export default function MembersShopPage() {
  const { status } = useSession()
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/api/auth/signin?callbackUrl=/members-shop')
    }
  }, [status, router])

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Activity className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-10">
        <MembersShopPanel variant="member" toastSuccess={toastSuccess} toastError={toastError} />
      </div>
    </div>
  )
}

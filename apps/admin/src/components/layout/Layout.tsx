import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function Layout() {
  return (
    <div className="grid h-screen grid-cols-[var(--width-sidebar)_1fr] grid-rows-[var(--height-topbar)_1fr] overflow-hidden">
      <div className="row-span-full">
        <Sidebar />
      </div>
      <TopBar />
      <main className="overflow-y-auto bg-gray-900 p-7">
        <Outlet />
      </main>
    </div>
  )
}

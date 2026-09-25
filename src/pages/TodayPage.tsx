import { BottomNav } from '../components/BottomNav'

export function TodayPage() {
  return <div className="page shell"><header className="brand">私人观察台</header><section className="hero">
    <p className="date">今天</p><h1>今天的你是什么样子？</h1><p>不需要每天完整记录。留下多少，由你决定。</p>
    <div className="stack"><a className="primary link-button" href="/record">去记录</a><button className="quiet">今天不记录</button></div>
  </section><BottomNav current="/" /></div>
}

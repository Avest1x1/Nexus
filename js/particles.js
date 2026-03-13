/*
  particles.js - custom canvas particle engine for Nexus Collective
  matches the config exactly: triangle shapes, purple fill, blue-purple links, repulse on hover, push on click
*/

(function () {

  const CONFIG = {
    count:       55,
    color:       '#bd00e6',
    strokeColor: '#d200ff',
    strokeWidth: 1,
    sizeValue:   0.5,
    sizeRandom:  true,
    opacity:     0.45,
    speed:       0.45,
    linkDist:    95,
    linkColor:   'rgba(172, 187, 255, {a})',
    linkOpacity: 0.38,
    repulseDist: 160,
    repulseForce:4,
    pushCount:   2,
  }

  class Particle {
    constructor(w, h) {
      this.w = w
      this.h = h
      this.reset(Math.random() * w, Math.random() * h)
    }

    reset(x, y) {
      this.x = x ?? Math.random() * this.w
      this.y = y ?? Math.random() * this.h
      const angle = Math.random() * Math.PI * 2
      const speed = (Math.random() * 0.5 + 0.5) * CONFIG.speed
      this.vx = Math.cos(angle) * speed
      this.vy = Math.sin(angle) * speed
      this.size = CONFIG.sizeRandom
        ? Math.random() * CONFIG.sizeValue * 2.5 + 1.5
        : CONFIG.sizeValue + 1.5
    }

    update(w, h) {
      this.x += this.vx
      this.y += this.vy

      if (this.x < -30) this.x = w + 30
      else if (this.x > w + 30) this.x = -30

      if (this.y < -30) this.y = h + 30
      else if (this.y > h + 30) this.y = -30
    }

    repulse(mx, my, dist) {
      const dx = this.x - mx
      const dy = this.y - my
      const force = (dist - Math.sqrt(dx*dx + dy*dy)) / dist
      if (force > 0) {
        const len = Math.sqrt(dx*dx + dy*dy) || 1
        this.x += (dx / len) * force * CONFIG.repulseForce
        this.y += (dy / len) * force * CONFIG.repulseForce
      }
    }

    draw(ctx) {
      const s = this.size
      ctx.save()
      ctx.translate(this.x, this.y)
      ctx.beginPath()
      ctx.moveTo(0, -s * 1.0)
      ctx.lineTo( s * 0.9,  s * 0.6)
      ctx.lineTo(-s * 0.9,  s * 0.6)
      ctx.closePath()
      ctx.fillStyle = CONFIG.color
      ctx.globalAlpha = CONFIG.opacity
      ctx.fill()
      ctx.strokeStyle = CONFIG.strokeColor
      ctx.lineWidth = CONFIG.strokeWidth
      ctx.globalAlpha = CONFIG.opacity * 0.9
      ctx.stroke()
      ctx.restore()
    }
  }

  class NexusParticles {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId)
      if (!this.canvas) return
      this.ctx = this.canvas.getContext('2d')
      this.particles = []
      this.mouse = { x: -9999, y: -9999, active: false }
      this.dpr = window.devicePixelRatio || 1
      this.w = 0
      this.h = 0
      this.animId = null

      this.resize()
      this.spawnAll()
      this.bindEvents()
      this.loop()
    }

    resize() {
      this.w = window.innerWidth
      this.h = window.innerHeight
      this.canvas.width  = this.w * this.dpr
      this.canvas.height = this.h * this.dpr
      this.canvas.style.width  = this.w + 'px'
      this.canvas.style.height = this.h + 'px'
      this.ctx.scale(this.dpr, this.dpr)
    }

    spawnAll() {
      this.particles = []
      for (let i = 0; i < CONFIG.count; i++) {
        this.particles.push(new Particle(this.w, this.h))
      }
    }

    spawnAt(x, y) {
      for (let i = 0; i < CONFIG.pushCount; i++) {
        const p = new Particle(this.w, this.h)
        p.reset(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30)
        this.particles.push(p)
      }
    }

    drawLinks() {
      const ctx = this.ctx
      const ps  = this.particles
      const dist = CONFIG.linkDist

      ctx.save()
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const dx = ps[i].x - ps[j].x
          const dy = ps[i].y - ps[j].y
          if (Math.abs(dx) > dist || Math.abs(dy) > dist) continue
          const d  = Math.sqrt(dx*dx + dy*dy)
          if (d < dist) {
            const a = CONFIG.linkOpacity * (1 - d / dist)
            ctx.beginPath()
            ctx.moveTo(ps[i].x, ps[i].y)
            ctx.lineTo(ps[j].x, ps[j].y)
            ctx.strokeStyle = CONFIG.linkColor.replace('{a}', a.toFixed(3))
            ctx.lineWidth = 1
            ctx.globalAlpha = 1
            ctx.stroke()
          }
        }
      }
      ctx.restore()
    }

    loop() {
      this.animId = requestAnimationFrame(() => this.loop())
      const ctx = this.ctx
      ctx.clearRect(0, 0, this.w, this.h)

      for (const p of this.particles) {
        p.update(this.w, this.h)
        if (this.mouse.active) {
          const dx = p.x - this.mouse.x
          const dy = p.y - this.mouse.y
          if (Math.sqrt(dx*dx + dy*dy) < CONFIG.repulseDist) {
            p.repulse(this.mouse.x, this.mouse.y, CONFIG.repulseDist)
          }
        }
      }

      this.drawLinks()

      for (const p of this.particles) {
        p.draw(ctx)
      }
    }

    bindEvents() {
      window.addEventListener('mousemove', e => {
        this.mouse.x = e.clientX
        this.mouse.y = e.clientY
        this.mouse.active = true
      })

      window.addEventListener('mouseleave', () => {
        this.mouse.active = false
        this.mouse.x = -9999
        this.mouse.y = -9999
      })

      window.addEventListener('click', e => {
        this.spawnAt(e.clientX, e.clientY)
      })

      let resizeTimer
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          const ctx = this.ctx
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          this.resize()
        }, 150)
      })
    }

    destroy() {
      if (this.animId) cancelAnimationFrame(this.animId)
    }
  }

  window.NexusParticles = NexusParticles

  /*
    auto-init on DOMContentLoaded
    main.js can also call new window.NexusParticles('particles-canvas') manually
    but this way it just works without extra setup
  */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window._nexusParticles = new NexusParticles('particles-canvas')
    })
  } else {
    window._nexusParticles = new NexusParticles('particles-canvas')
  }

})()
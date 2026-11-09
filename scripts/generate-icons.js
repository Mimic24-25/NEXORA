#!/usr/bin/env node
const { createCanvas } = require('canvas')

function createIcon(size, filename) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  
  // Фон с градиентом
  const grad = ctx.createLinearGradient(0, 0, size, size)
  grad.addColorStop(0, '#06b6d4')
  grad.addColorStop(1, '#0891b2')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.roundRect(0, 0, size, size * 0.16, size * 0.16)
  ctx.fill()
  
  // Буква N
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${size * 0.55}px Arial, Helvetica, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('N', size / 2, size / 2 + size * 0.05)
  
  canvas.savePNG(filename)
  console.log(`Created ${filename} (${size}x${size})`)
}

createIcon(192, 'public/icons/icon-192x192.png')
createIcon(512, 'public/icons/icon-512x512.png')
console.log('Done!')

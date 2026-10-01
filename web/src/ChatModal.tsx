import ChatView from './ChatView'
import { Modal } from './ui'

// Chat de un cliente dentro de un modal (por ejemplo, desde un pedido)
export default function ChatModal({ telefono, titulo, onClose }: { telefono: string | null; titulo: string; onClose: () => void }) {
  return (
    <Modal abierto={!!telefono} titulo={titulo} onClose={onClose} ancho={620}>
      {telefono && <div className="chat-en-modal"><ChatView telefono={telefono} /></div>}
    </Modal>
  )
}

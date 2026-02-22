import { Box, Button, Modal, Text } from "@saleor/macaw-ui";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmModal = ({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onClose,
}: ConfirmModalProps) => (
  <Modal open={open} onChange={(o: boolean) => !o && onClose()}>
    <Modal.Content>
      <Box padding={6} __maxWidth="480px">
        <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>
          {title}
        </Text>
        <Text marginBottom={6}>{message}</Text>
        <Box display="flex" gap={3} justifyContent="flex-end">
          <Modal.Close>
            <Button variant="secondary">{cancelLabel}</Button>
          </Modal.Close>
          <Button
            variant="primary"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </Box>
      </Box>
    </Modal.Content>
  </Modal>
);

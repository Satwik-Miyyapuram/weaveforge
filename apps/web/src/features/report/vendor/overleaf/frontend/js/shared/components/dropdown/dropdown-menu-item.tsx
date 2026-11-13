import { OLDropdownItem } from '../ol/ol-dropdown-menu'
import { OLDropdownItemProps } from '../types/dropdown-menu-props'
import DropdownListItem from './dropdown-list-item'

// This represents a menu item. It wraps the item within an <li> element.
function DropdownMenuItem(props: OLDropdownItemProps) {
  return (
    <DropdownListItem>
      <OLDropdownItem {...props} />
    </DropdownListItem>
  )
}

export default DropdownMenuItem

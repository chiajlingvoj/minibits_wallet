import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useState} from 'react'
import {ColorValue, Share, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {ContactsStackScreenProps} from '../navigation'
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal} from '../components'
import {MINIBITS_NIP05_DOMAIN} from '@env'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import { ProfileHeader } from './Contacts/ProfileHeader'
import Clipboard from '@react-native-clipboard/clipboard'

interface ProfileScreenProps extends ContactsStackScreenProps<'Profile'> {}

export const ProfileScreen: FC<ProfileScreenProps> = observer(
  function ProfileScreen({navigation}) {    
    
    useHeader({        
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
        rightIcon: 'faShareFromSquare',
        onRightPress: () => onShareContact()
    })

    const {walletProfileStore} = useStores() 
    const {npub, name, picture} = walletProfileStore

    const [info, setInfo] = useState('')    
    const [error, setError] = useState<AppError | undefined>()


    const onShareContact = async () => {
        try {
            const result = await Share.share({
                message: `${name+MINIBITS_NIP05_DOMAIN}`,
            })

            if (result.action === Share.sharedAction) {                
                setTimeout(
                    () =>
                    setInfo(
                        'Contact has been shared',
                    ),
                    500,
                )
            } else if (result.action === Share.dismissedAction) {
                setInfo(
                    'Contact sharing cancelled',
                )
            }
        } catch (e: any) {
            handleError(e)
        }
    }
        
    const gotoAvatar = function() {
      navigation.navigate('Picture')
    }

    const gotoWalletName = function() {
      navigation.navigate('WalletName')
    }

    const onCopyNpub = function () {        
        try {
            Clipboard.setString(npub)
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
        }
    }

    const handleError = function (e: AppError): void {        
        setError(e)
    }

    const iconNpub = useThemeColor('textDim')
    
    return (
      <Screen contentContainerStyle={$screen} preset='auto'>        
        <ProfileHeader 
            picture={picture as string}
            name={name as string}
        />        
        <View style={$contentContainer}>
          <Card
            style={$card}
            ContentComponent={
                <WalletProfileActionsBlock 
                    gotoAvatar={gotoAvatar}
                    gotoWalletName={gotoWalletName}
                />
            }
          />
        </View>
        <View style={$bottomContainer}>
                <View style={$buttonContainer}>
                    <Icon icon='faCopy' size={spacing.small} color={iconNpub as ColorValue} />
                    <Button
                        preset='secondary'
                        textStyle={{fontSize: 12}}
                        text={npub.slice(0,15)+'...'}
                        onPress={onCopyNpub}
                    /> 
                </View>    
        </View>
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  },
)

const WalletProfileActionsBlock = function (props: {
    gotoAvatar: any
    gotoWalletName: any
}) {
return (
    <>
        <ListItem
            tx='profileScreen.changeAvatar'
            subTx='profileScreen.changeAvatarSubtext'
            leftIcon='faCircleUser'
            leftIconInverse={true}
            leftIconColor={colors.palette.iconMagenta200}              
            onPress={props.gotoAvatar}
            bottomSeparator={true}
            style={{paddingRight: spacing.medium}}
        />
        <ListItem
            tx='profileScreen.changeWalletname'
            subTx='profileScreen.changeWalletnameSubtext'
            leftIcon='faPencil'
            leftIconInverse={true} 
            leftIconColor={colors.palette.iconBlue200}
            onPress={props.gotoWalletName}
            style={{paddingRight: spacing.medium}}
        />
    </>
)
}

const $screen: ViewStyle = {
    flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    padding: spacing.medium,
    height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
    // flex: 1,
    padding: spacing.extraSmall,
    // alignItems: 'center',
}

const $bottomModal: ViewStyle = {
    // flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.large,
    paddingHorizontal: spacing.small,
}

const $bottomContainer: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',    
    alignSelf: 'stretch',    
  }

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
}

const $qrCodeContainer: ViewStyle = {
    backgroundColor: 'white',
    padding: spacing.small,
    margin: spacing.small,
}

const $card: ViewStyle = {
    // marginVertical: 0,
}

const $item: ViewStyle = {
    // paddingHorizontal: spacing.small,
    paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
    padding: spacing.extraSmall,
    alignSelf: 'center',
    marginLeft: spacing.small,
}
